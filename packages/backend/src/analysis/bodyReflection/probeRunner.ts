// Probe execution logic extracted from bodyReflection.ts for clarity and testability.
// Handles batching, stability assessment, detection, and successful character harvesting.

type SDK = any;
import { randomValue, findMatches } from "../../utils/text.js";
import { mutateParamValue } from "../../utils/query.js";
import { passesContentTypeGating } from "../../utils/http.js";
import { ConfigStore } from "../../stores/configStore.js";
import { allowedDetectionContextsFor, isLiteralContext } from "../../utils/contexts.js";
import { classifySeverity } from "../scoring.js";
import { CONTEXT, prettyPrintContext, toCanonical } from "../contextMap.js";
import type { SeverityTier } from "../../core/types.js";
import JsonResponseBodyPayloadGenerator from "../../payload/jsonResponseBodyPayloadGenerator.ts";
import JsResponseBodyPayloadGenerator from "../../payload/jsResponseBodyPayloadGenerator.ts";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";
import { isJsContentType } from "../../utils/http.js";

export interface ProbeResult {
    confirmed: boolean;
    reflected: boolean;
    successfulChars: Set<string>;
    bestContext: string;
    // Reflection count of the first batch's leading marker, so a confirmed param does
    // not need a separate count probe. Absent when the first batch got no response.
    firstBatchCount?: CountProbeResult;
    // A batch got no usable response (send error, timeout, abort), so the result is
    // incomplete and must not count as a clean "tested, not confirmed".
    batchFailed: boolean;
}

// Long enough that the count marker cannot collide with existing page text.
const COUNT_MARKER_LEN = 12;

export interface CountProbeResult {
    matches: Array<[number, number]>;
    value: string;
    code: number;
}

// String-terminating characters, in priority order. An error-gated reflection
// (input echoed only inside a server error message — e.g. a MariaDB syntax error —
// triggered by a quote) truncates the response to the text AFTER the breaking char,
// so any character probed before it in the shared batch blob is invisible. Probing
// these terminators first means whichever one actually breaks the statement fires the
// error as early as possible, leaving the higher-severity chars (<, >) in the surviving
// window. For a normal reflection the whole blob echoes regardless of order, so this is
// a no-op there.
const BREAKOUT_FIRST = ["\\", "'", '"', "`"];

const SEVERITY_RANK: Record<SeverityTier, number> = {
    info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

// HTML-family contexts where a raw tag-opening char is a live reflected XSS.
// A sealed higher-priority context (e.g. a fully-escaped JS string) picked by the
// context ladder must not mask one of these when a breakout char actually survived.
const HTML_FAMILY_CONTEXTS = new Set<string>([
    "html", "svgContext", "mathContext", "rawtextElement", "htmlComment", "htmlBaseInjection",
]);

// Tie-break order when several HTML-family contexts share the top severity: plain HTML
// flow text is the most direct and least ambiguous, so it is preferred over a looser
// rawtext/comment match that may have claimed the same raw "<" occurrence.
const HTML_FAMILY_PREFERENCE = [
    "html", "svgContext", "mathContext", "htmlBaseInjection", "rawtextElement", "htmlComment",
];

// `contextLabel` must be a display label (e.g. "HTML Comment", "Script String (\")"),
// not a raw detection key -- classifySeverity reads the enclosing quote from the label,
// so prettyPrintContext must be applied to raw keys BEFORE calling this, never here
// (re-prettifying a label strips its quote and misreads an inert char as a breakout).
function severityOf(contextLabel: string, chars: Set<string>): SeverityTier {
    return classifySeverity({
        confirmed: true,
        allowedChars: Array.from(chars),
        context: contextLabel,
        header: false,
    });
}

// A quote char inside a JS string with a different delimiter cannot end it; these script
// detections are dropped for it (the char may still count in HTML/attribute contexts).
const QUOTE_CHARS = new Set(["'", '"', "`"]);
const JS_STRING_DETECTIONS = new Set(["jsInQuote", "jsInQuoteEscaped", "js", "jsTemplateLiteral"]);

// Script contexts where a lone "<" only matters as the start of "</script". Many
// serializers (Marko, Next.js, serialize-javascript, PHP json_encode) escape the
// "</" sequence (or "/") while leaving a lone "<" and "/" raw, so per-char probes
// see both survive although "</script>" never can.
const SCRIPT_TAG_ESCAPE_CONTEXTS = new Set<string>([
    CONTEXT.JS, CONTEXT.JS_IN_QUOTE, CONTEXT.JS_TEMPLATE_LITERAL,
]);

function needsScriptCloseProbe(bestContext: string, chars: Set<string>): boolean {
    if (!chars.has('<')) return false;
    const canonical = toCanonical(bestContext) ?? bestContext;
    return SCRIPT_TAG_ESCAPE_CONTEXTS.has(canonical);
}

// Header values are transmitted verbatim (not URL-decoded server-side), and Path
// segments are encoded exactly once by mutateParamValue. Pre-encoding the probe char
// here would leave it percent-encoded in the reflection (Header) or double-encoded
// (Path), so the dangerous char never reflects raw and severity is under-reported.
// URL/Body/Cookie are decoded once in transit, so they still need encoding here.
function encodeForSource(param: any, raw: string): string {
    const skipEncode = param.source === 'BodyJson' || param.source === 'BodyJsonRaw'
        || param.source === 'UrlJson' || param.source === 'Header' || param.source === 'Path';
    return skipEncode ? raw : encodeURIComponent(raw);
}

type ComboOutcome = 'breakout' | 'sealed' | 'inconclusive';

// When "\" reflects in a JS string but the enclosing quote does not, test whether
// "\"+quote bypasses the server's escaping (server escapes " to \" but not \, so
// \" -> \\" = breakout). "sealed" means the markers reflected but stayed inside the
// string; "inconclusive" (probe failed / markers absent) must not change the verdict.
async function backslashQuoteCombo(
    sdk: SDK, request: any, param: any, quote: string
): Promise<ComboOutcome> {
    const pre = randomValue(5);
    const suf = randomValue(5);
    const probeSpec: any = request.toSpec();
    mutateParamValue(probeSpec, param, pre + encodeForSource(param, '\\' + quote) + suf, sdk);
    sdk.console.log(`[Reflector++] Combo probe \\${quote} for ${param.key}`);
    try {
        const probe = await sdk.requests.send(probeSpec);
        const body: string = probe.response.getBody()?.toText() || '';
        const pg = isJsContentType(probe.response.getHeader('Content-Type'))
            ? new JsResponseBodyPayloadGenerator(body)
            : new ResponseBodyPayloadGenerator(body);
        if (pg.isInScriptOutsideString(suf)) return 'breakout';
        return body.includes(pre) && body.includes(suf) ? 'sealed' : 'inconclusive';
    } catch (e) {
        sdk.console.log(`[Reflector++] Combo probe error: ${e}`);
        return 'inconclusive';
    }
}

// Sends "pre</script>suf" and reports whether the sequence came back escaped.
// Returns false (keep "<") when the probe fails or the markers do not reflect at
// all -- e.g. a WAF block -- so an inconclusive probe never downgrades a finding.
async function scriptCloseIsEscaped(sdk: SDK, request: any, param: any): Promise<boolean> {
    const seq = '</script>';
    const pre = randomValue(5);
    const suf = randomValue(5);
    const probeSpec: any = request.toSpec();
    mutateParamValue(probeSpec, param, pre + encodeForSource(param, seq) + suf, sdk);
    sdk.console.log(`[Reflector++] Script-close combo probe for ${param.key}`);
    try {
        const probe = await sdk.requests.send(probeSpec);
        const body: string = probe.response.getBody()?.toText() || '';
        if (body.includes(pre + seq + suf)) return false;
        return body.includes(pre) && body.includes(suf);
    } catch (e) {
        sdk.console.log(`[Reflector++] Script-close combo probe error for ${param.key}: ${e}`);
        return false;
    }
}

export function orderPayloadBreakoutFirst(payload: string[]): string[] {
    return [...payload].sort((a, b) => {
        const ia = BREAKOUT_FIRST.indexOf(a);
        const ib = BREAKOUT_FIRST.indexOf(b);
        if (ia === ib) return 0; // both absent (-1) or same char: preserve order (stable)
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
}

const BATCH = 8;

interface Marker { ch: string; pre: string; suf: string }

interface SentBatch {
    i: number;
    markers: Marker[];
    outcome: Promise<{ probe: any } | { error: unknown }>;
}

// Sends one probe per batch of up to BATCH chars, each char wrapped in random markers.
// Outcomes are pre-settled so a rejection is never unhandled while earlier batches are
// still being analysed.
function buildBatches(sdk: SDK, request: any, param: any, orderedPayload: string[]): SentBatch[] {
    const out: SentBatch[] = [];
    for (let i = 0; i < orderedPayload.length; i += BATCH) {
        const batch = orderedPayload.slice(i, i + BATCH);
        const markers = batch.map((ch: string, j: number) => ({
            ch,
            pre: randomValue(i === 0 && j === 0 ? COUNT_MARKER_LEN : 5),
            suf: randomValue(5),
        }));
        const injected = markers.map((m) => m.pre + encodeForSource(param, m.ch) + m.suf).join("");
        const probeSpec: any = request.toSpec();
        mutateParamValue(probeSpec, param, injected, sdk as any);
        sdk.console.log(`[Reflector++] Probing ${param.key} with batch [${batch.join(', ')}]`);
        const outcome = (sdk as any).requests.send(probeSpec).then(
            (probe: any) => ({ probe }),
            (error: unknown) => ({ error }),
        );
        out.push({ i, markers, outcome });
    }
    return out;
}

export async function runProbes(
    sdk: SDK,
    request: any,
    param: any,
    contextInfo: any,
    initialBestContext: string
): Promise<ProbeResult> {
    const successfulChars = new Set<string>();
    // Breakout chars seen literal in an HTML-family context, keyed by that context.
    // Used after probing to escalate past a sealed context the ladder chose first.
    const htmlFamilyChars = new Map<string, Set<string>>();
    let confirmed = false; let reflected = false; let bestContext = initialBestContext;
    let firstBatchCount: CountProbeResult | undefined;
    let batchFailed = false;
    if (!contextInfo || !Array.isArray(contextInfo.payload) || contextInfo.payload.length === 0) {
        return { confirmed: false, reflected: false, successfulChars, bestContext, batchFailed: false };
    }
    const orderedPayload = orderPayloadBreakoutFirst(contextInfo.payload);
    // All batches are sent at once (the probe limiter caps how many are in flight), then
    // their responses are analysed in batch order so the result does not depend on which
    // response arrives first.
    const batches = buildBatches(sdk, request, param, orderedPayload);
    for (const { i, markers, outcome } of batches) {
        try {
            const settled = await outcome;
            if ('error' in settled) throw settled.error;
            const probe = settled.probe;
            if (i === 0) firstBatchCount = countMarker(probe, markers[0].pre, sdk);
            const ctHeader = probe.response.getHeader('Content-Type');
            const nosniffHeader = probe.response.getHeader('X-Content-Type-Options');
            const probeCtGated = passesContentTypeGating(ctHeader, nosniffHeader)
                || (ConfigStore.getCheckJsResponseReflections() && isJsContentType(ctHeader));
            if (!probeCtGated) {
                sdk.console.log('[Reflector++] Probe response content-type gating failed, skipping batch');
                continue;
            }
            const probeBody = probe.response.getBody()?.toText() || '';
            const normalizedContentType = Array.isArray(ctHeader)
                ? ctHeader.find((value) => value && value.trim() !== "")
                : typeof ctHeader === "string" && ctHeader.trim() !== "" ? ctHeader : "";
            const contentType = normalizedContentType.toLowerCase();
            const isJsonResponse = contentType.startsWith("application/json");
            const isJsResponse = isJsContentType(contentType);
            const detectPg = isJsonResponse
                ? new JsonResponseBodyPayloadGenerator(probeBody)
                : isJsResponse
                ? new JsResponseBodyPayloadGenerator(probeBody)
                : new ResponseBodyPayloadGenerator(probeBody);
            for (const m of markers) {
                const encodedNeedle = m.pre + encodeURIComponent(m.ch) + m.suf;
                const decodedNeedle = m.pre + m.ch + m.suf;
                const foundEncoded = findMatches(probeBody, encodedNeedle, true, sdk).length > 0;
                const foundDecoded = findMatches(probeBody, decodedNeedle, true, sdk).length > 0;
                if (!foundEncoded && !foundDecoded) continue;
                reflected = true;
                let detections = detectPg.detect({ console: (sdk as any).console }, { context: contextInfo.context }, m.pre, m.ch, m.suf);
                if (QUOTE_CHARS.has(m.ch) && typeof (detectPg as any).isQuoteInertInScript === 'function'
                    && (detectPg as any).isQuoteInertInScript(markers[0].pre, m.pre, m.ch, m.suf)) {
                    sdk.console.log(`[Reflector++] "${m.ch}" for ${param.key} sits in a foreign-quote JS string; inert`);
                    detections = detections.filter((d: any) => !JS_STRING_DETECTIONS.has(d.context));
                }
                if (detections.length > 0) {
                    confirmed = true;
                    const acceptedCtx = allowedDetectionContextsFor(bestContext);
                    const literalInContext = detections.some((d: any) => isLiteralContext(d.context) && (acceptedCtx.size === 0 || acceptedCtx.has(d.context)));
                    if (literalInContext) successfulChars.add(m.ch);
                    for (const d of detections) {
                        if (isLiteralContext(d.context) && HTML_FAMILY_CONTEXTS.has(d.context)) {
                            let s = htmlFamilyChars.get(d.context);
                            if (!s) { s = new Set<string>(); htmlFamilyChars.set(d.context, s); }
                            s.add(m.ch);
                        }
                    }
                    if (/^html$/i.test(bestContext) || /^body$/i.test(bestContext)) {
                        const preferred = detections.find((d: any) => isLiteralContext(d.context));
                        if (preferred) bestContext = preferred.context;
                    }
                }
            }
        } catch (e) {
            batchFailed = true;
            (sdk as any).console.log(`[Reflector++] Probe error for ${param.key}: ${e}`);
        }
    }
    // A "\" only matters in a quoted JS string if it defeats the quote escaping. Test
    // that directly; when the markers reflect but stay sealed, the "\" seen by the
    // per-char probe was an escaped (e.g. nested-serialized) copy, not a live one.
    const enclosingQuote = bestContext.match(/\((['"])\)$/)?.[1];
    if (confirmed && enclosingQuote && successfulChars.has('\\')
        && !successfulChars.has(enclosingQuote)) {
        const outcome = await backslashQuoteCombo(sdk, request, param, enclosingQuote);
        if (outcome === 'breakout') successfulChars.add(enclosingQuote);
        if (outcome === 'sealed') successfulChars.delete('\\');
        sdk.console.log(`[Reflector++] Combo \\${enclosingQuote} for ${param.key}: ${outcome}`);
    }
    if (confirmed && needsScriptCloseProbe(bestContext, successfulChars)
        && await scriptCloseIsEscaped(sdk, request, param)) {
        sdk.console.log(`[Reflector++] "</script>" escaped for ${param.key}; dropping "<"`);
        successfulChars.delete('<');
    }
    // Post-processing: In JSON string contexts where quote breakout
    // is impossible (" and \ both escaped), structural chars (, } ] :)
    // are trapped and not exploitable. Remove them.
    const ctxArr: string[] = contextInfo?.context ?? [];
    const jsonStrCtxs = new Set(["jsonString", "jsonInQuote"]);
    const jsonStructCtxs = new Set(["jsonStructure", "json"]);
    const hasJsonStr = ctxArr.some((c: string) => jsonStrCtxs.has(c));
    const hasJsonStruct = ctxArr.some((c: string) => jsonStructCtxs.has(c));
    if (hasJsonStr && !hasJsonStruct) {
        const quoteBreakable = successfulChars.has('"') || successfulChars.has("\\");
        const scriptBreakable = ctxArr.includes("jsonInQuote") && successfulChars.has("<");
        if (!quoteBreakable && !scriptBreakable) {
            for (const sc of [",", "}", "]", ":", "/"]) successfulChars.delete(sc);
            const hasExploitable = [...successfulChars].some(c => c !== "");
            if (!hasExploitable) confirmed = false;
        }
    }
    // Escalate to a live HTML-family context when the ladder chose a sealed context.
    // Report the worst breakout that actually works: if a tag-opening char survived in
    // HTML text (or SVG/MathML/rawtext/comment) and scores higher than the chosen
    // context, switch to it so a sealed JS string / attribute does not mask live XSS.
    // Among contexts that tie on severity, prefer the most direct one (plain HTML over
    // a looser rawtext/comment match that may have claimed the same occurrence).
    if (confirmed && htmlFamilyChars.size > 0) {
        const chosenRank = SEVERITY_RANK[severityOf(bestContext, successfulChars)];
        let best: { ctx: string; chars: Set<string>; rank: number; pref: number } | undefined;
        for (const [ctx, chars] of htmlFamilyChars) {
            const rank = SEVERITY_RANK[severityOf(prettyPrintContext(ctx) ?? ctx, chars)];
            if (rank <= chosenRank) continue;
            const pref = HTML_FAMILY_PREFERENCE.indexOf(ctx);
            if (!best || rank > best.rank || (rank === best.rank && pref < best.pref)) {
                best = { ctx, chars, rank, pref };
            }
        }
        if (best) {
            bestContext = prettyPrintContext(best.ctx) ?? best.ctx;
            successfulChars.clear();
            for (const c of best.chars) successfulChars.add(c);
        }
    }
    return { confirmed, reflected, successfulChars, bestContext, firstBatchCount, batchFailed };
}

function countMarker(probe: any, marker: string, sdk: SDK): CountProbeResult {
    const body = probe.response.getBody()?.toText() || '';
    const matches = findMatches(body, marker, true, sdk);
    return { matches, value: marker, code: probe.response.getCode?.() ?? 0 };
}

export async function runCountProbe(
    sdk: SDK,
    request: any,
    param: any
): Promise<CountProbeResult | undefined> {
    const marker = randomValue(COUNT_MARKER_LEN);
    const probeSpec: any = request.toSpec();
    mutateParamValue(probeSpec, param, marker, sdk as any);
    sdk.console.log(
        `[Reflector++] Count probe for "${param.key}" with marker ${marker}`
    );
    try {
        const probe = await (sdk as any).requests.send(probeSpec);
        const result = countMarker(probe, marker, sdk);
        sdk.console.log(
            `[Reflector++] Count probe found ${result.matches.length} reflection(s)`
        );
        return result;
    } catch (e) {
        (sdk as any).console.log(
            `[Reflector++] Count probe error for ${param.key}: ${e}`
        );
        return undefined;
    }
}
