// src/analysis/scoring.ts (moved from src/scoring.ts)
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

export type ScoreResult = {
    confidence: number;
    severity: number;
    total: number;  // use as "certainty" for backward compat
};

// --- Escaped/alias handling + context base weights ---
const CONTEXT_SEVERITY_BASE: Record<string, number> = {
    // JS contexts
    js: 80,
    jsInQuote: 72,
    "Script": 80,            // legacy alias
    "Script String": 72,     // legacy alias

    // Event handlers
    eventHandler: 78,
    eventHandlerEscaped: 28, // NEW: down-ranked

    // Attributes
    attributeInQuote: 66,
    attribute: 40,
    attributeEscaped: 22,    // NEW: down-ranked
    'Tag Attribute (") Value': 66, // legacy alias
    "Tag Attribute (') Value": 66, // legacy alias

    // CSS
    css: 45,
    cssInQuote: 38,

    // Markup / other
    html: 35,
    HTML: 35,                // legacy alias
    htmlComment: 20,         // NEW: low signal

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

function confidenceScore(inp: ScoreInputs): number {
    let c = 30;
    if (inp.confirmed) c += 25;
    if (inp.stableProbe) c += 10;
    if (inp.matchCount && inp.matchCount > 1) c += Math.min(10, inp.matchCount * 2);
    if (isEscapedContext(inp.context)) c -= 12; // penalty for encoded-only
    return clamp(c);
}

function severityScore(inp: ScoreInputs): number {
    let base = inp.header ? Math.max(40, headerWeight(inp.headerNames)) : contextWeight(inp.context);
    base += Math.round(charSetScore(inp.allowedChars) * 0.6); // char set contribution
    const ctxKey = normalizeContextKey(inp.context);
    const isScript = /script/i.test(inp.context) || ctxKey === "js" || ctxKey === "jsInQuote";
    if (isScript && (inp.allowedChars.includes('"') || inp.allowedChars.includes("'"))) base += 12;
    if (isScript && inp.allowedChars.includes("<")) base += 6;
    if (isEscapedContext(inp.context)) base -= 18; // non-breakout contexts
    if (/htmlcomment/i.test(inp.context)) base -= 10;
    return clamp(base);
}

export function scoreFinding(inp: ScoreInputs): ScoreResult {
    const confidence = confidenceScore(inp);
    const severity = severityScore(inp);
    const total = clamp(Math.round(0.55 * confidence + 0.45 * severity - 0.1 * Math.abs(confidence - severity)));
    return { confidence, severity, total };
}
