// src/analysis/scoring.ts (moved from src/scoring.ts)
import { CONTEXT } from './contextMap.js';
export type ScoreInputs = {
    confirmed: boolean;
    allowedChars: string[];   // e.g., ['<','"','"']
    context: string;          // "Script", "Script String", 'Tag Attribute (") Value', "HTML", "Response Header"
    header?: boolean;
    headerNames?: string[];
    matchCount?: number;
    bodyLength?: number;
    stableProbe?: boolean;
};

export type ScoreDelta = { label: string; delta: number; base?: number };
export type ScoreRationale = {
    confidence: ScoreDelta[];
    severity: ScoreDelta[];      // positive contributions
    penalties: ScoreDelta[];     // negative adjustments & clamp
};
export type ScoreCategories = {
    confidence: 'low' | 'moderate' | 'high' | 'proven';
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    total: 'weak' | 'likely' | 'strong';
};
export type ScoreResult = {
    confidence: number;
    severity: number;
    total: number;  // use as "certainty" for backward compat
    rationale: ScoreRationale;
    categories: ScoreCategories;
};

// Declarative factor tables (Suggestion C)
export const CONFIDENCE_FACTORS = {
    base: 30,
    confirmed: 25,
    stableProbe: 10,
    perExtraMatch: 2,
    perExtraMatchMax: 10,
    escapedPenalty: -12,
};

export const SEVERITY_FACTORS = {
    charSetMultiplier: 0.6,
    scriptQuoteBonus: 12,
    scriptTagBonus: 6,
    escapedPenalty: -18,
    htmlCommentPenalty: -10,
    headerFloor: 40,
};

// --- Escaped/alias handling + context base weights ---
const CONTEXT_SEVERITY_BASE: Record<string, number> = {
    // JS contexts
    [CONTEXT.JS]: 80,
    [CONTEXT.JS_IN_QUOTE]: 72,
    "Script": 80,            // legacy alias
    "Script String": 72,     // legacy alias

    // Event handlers
    [CONTEXT.EVENT_HANDLER]: 78,
    [CONTEXT.EVENT_HANDLER_ESCAPED]: 28, // NEW: down-ranked

    // Attributes
    [CONTEXT.ATTRIBUTE_IN_QUOTE]: 66,
    [CONTEXT.ATTRIBUTE]: 40,
    [CONTEXT.ATTRIBUTE_ESCAPED]: 22,    // NEW: down-ranked
    'Tag Attribute (") Value': 66, // legacy alias
    "Tag Attribute (') Value": 66, // legacy alias

    // CSS
    [CONTEXT.CSS]: 45,
    [CONTEXT.CSS_IN_QUOTE]: 38,

    // Markup / other
    [CONTEXT.HTML]: 35,
    HTML: 35,                // legacy alias
    [CONTEXT.HTML_COMMENT]: 20,         // NEW: low signal

    // Headers
    "Response Header": 50,
};

function normalizeContextKey(ctx: string): string {
    if (!ctx) return "HTML";
    const c = ctx.trim();
    if (CONTEXT_SEVERITY_BASE[c] !== undefined) return c;
    const alias: Record<string, string> = {
        "Script": "js",
        "Script String": "jsInQuote",
        "HTML": "html",
    };
    return alias[c] ?? c;
}

function isEscapedContext(ctx: string): boolean {
    const k = (ctx || "").toLowerCase();
    return k === "attributeescaped" || k === "eventhandlerescaped";
}

const HEADER_WEIGHTS: Record<string, number> = {
    "location": 75,
    "refresh": 75,
    "set-cookie": 65,
    "content-security-policy": 70,
    "access-control-allow-origin": 55,
    "access-control-allow-credentials": 55,
    "link": 45
};

function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

function contextWeight(ctx: string): number {
    const key = normalizeContextKey(ctx);
    return CONTEXT_SEVERITY_BASE[key] ?? 30;
}

function headerWeight(headers?: string[]): number {
    if (!headers?.length) return 0;
    let w = 0;
    for (const h of headers) w = Math.max(w, HEADER_WEIGHTS[h.toLowerCase()] ?? 35);
    return w;
}

function charSetScore(chars: string[]): number {
    if (!chars?.length) return 0;
    const s = new Set(chars);
    let n = 0;
    if (s.has("<")) n += 15;
    if (s.has(">")) n += 5;
    if (s.has('"') || s.has("'")) n += 10;
    if (s.has("`")) n += 8;
    if (s.has("=")) n += 5;
    if (s.has(" ")) n += 4;
    if (s.has("/")) n += 3;
    if (s.has(":")) n += 4;
    return Math.min(n, 40);
}

// Confidence with rationale accumulation
function computeConfidence(inp: ScoreInputs, rationale: ScoreDelta[], penalties: ScoreDelta[]): number {
    let c = CONFIDENCE_FACTORS.base;
    rationale.push({ label: 'Base', delta: CONFIDENCE_FACTORS.base });
    if (inp.confirmed) { c += CONFIDENCE_FACTORS.confirmed; rationale.push({ label: 'Confirmed reflection', delta: CONFIDENCE_FACTORS.confirmed }); }
    if (inp.stableProbe) { c += CONFIDENCE_FACTORS.stableProbe; rationale.push({ label: 'Stable probe', delta: CONFIDENCE_FACTORS.stableProbe }); }
    if (inp.matchCount && inp.matchCount > 1) {
        const extraMatches = Math.min(CONFIDENCE_FACTORS.perExtraMatchMax, inp.matchCount * CONFIDENCE_FACTORS.perExtraMatch);
        c += extraMatches;
        rationale.push({ label: 'Multiple matches', delta: extraMatches });
    }
    if (isEscapedContext(inp.context)) { c += CONFIDENCE_FACTORS.escapedPenalty; penalties.push({ label: 'Escaped context penalty', delta: CONFIDENCE_FACTORS.escapedPenalty }); }
    const clamped = clamp(c);
    if (clamped !== c) penalties.push({ label: 'Clamp applied', delta: clamped - c });
    return clamped;
}

// Severity with rationale accumulation
function computeSeverity(inp: ScoreInputs, rationale: ScoreDelta[], penalties: ScoreDelta[]): number {
    const isHeader = !!inp.header;
    let base = isHeader ? Math.max(SEVERITY_FACTORS.headerFloor, headerWeight(inp.headerNames)) : contextWeight(inp.context);
    rationale.push({ label: isHeader ? 'Header base weight' : `Context base (${normalizeContextKey(inp.context)})`, delta: base, base });

    // Char set contribution
    const rawCharScore = charSetScore(inp.allowedChars);
    if (rawCharScore > 0) {
        const contrib = Math.round(rawCharScore * SEVERITY_FACTORS.charSetMultiplier);
        rationale.push({ label: `Allowed char capability (+${rawCharScore} *${SEVERITY_FACTORS.charSetMultiplier})`, delta: contrib });
        base += contrib;
    }
    const ctxKey = normalizeContextKey(inp.context);
    const isScript = /script/i.test(inp.context) || ctxKey === 'js' || ctxKey === 'jsInQuote';
    if (isScript && (inp.allowedChars.includes('"') || inp.allowedChars.includes("'"))) { base += SEVERITY_FACTORS.scriptQuoteBonus; rationale.push({ label: 'Script quote breakout bonus', delta: SEVERITY_FACTORS.scriptQuoteBonus }); }
    if (isScript && inp.allowedChars.includes('<')) { base += SEVERITY_FACTORS.scriptTagBonus; rationale.push({ label: 'Script < bonus', delta: SEVERITY_FACTORS.scriptTagBonus }); }
    if (isEscapedContext(inp.context)) { base += SEVERITY_FACTORS.escapedPenalty; penalties.push({ label: 'Escaped context penalty', delta: SEVERITY_FACTORS.escapedPenalty }); }
    if (/htmlcomment/i.test(inp.context)) { base += SEVERITY_FACTORS.htmlCommentPenalty; penalties.push({ label: 'HTML comment penalty', delta: SEVERITY_FACTORS.htmlCommentPenalty }); }
    const unclamped = base;
    const clamped = clamp(base);
    if (clamped !== unclamped) penalties.push({ label: 'Clamp applied', delta: clamped - unclamped });
    return clamped;
}

// Category mapping (Suggestion D)
function mapConfidenceCategory(v: number): ScoreCategories['confidence'] {
    if (v >= 70) return 'proven';
    if (v >= 55) return 'high';
    if (v >= 35) return 'moderate';
    return 'low';
}
function mapSeverityCategory(v: number): ScoreCategories['severity'] {
    if (v >= 80) return 'critical';
    if (v >= 60) return 'high';
    if (v >= 40) return 'medium';
    if (v >= 20) return 'low';
    return 'info';
}
function mapTotalCategory(v: number): ScoreCategories['total'] {
    if (v >= 55) return 'strong';
    if (v >= 30) return 'likely';
    return 'weak';
}

export function scoreFinding(inp: ScoreInputs): ScoreResult {
    const confidenceRationale: ScoreDelta[] = [];
    const severityRationale: ScoreDelta[] = [];
    const penalties: ScoreDelta[] = [];

    const confidence = computeConfidence(inp, confidenceRationale, penalties);
    const severity = computeSeverity(inp, severityRationale, penalties);
    const total = clamp(Math.round(0.55 * confidence + 0.45 * severity - 0.1 * Math.abs(confidence - severity)));

    const categories: ScoreCategories = {
        confidence: mapConfidenceCategory(confidence),
        severity: mapSeverityCategory(severity),
        total: mapTotalCategory(total)
    };

    return {
        confidence,
        severity,
        total,
        rationale: { confidence: confidenceRationale, severity: severityRationale, penalties },
        categories
    };
}
