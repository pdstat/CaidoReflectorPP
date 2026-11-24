import type { LogSdk } from "../core/types.js";

// Payload generator for standalone JavaScript responses (application/javascript,
// text/javascript, ...). The whole body is script, so -- unlike the HTML-aware
// ResponseBodyPayloadGenerator -- context is decided purely by JS string state:
// inside "..." / '...' is a string, inside `...` a template literal, otherwise
// executable code. Mirrors JsonResponseBodyPayloadGenerator's generate()/detect()
// contract so probeRunner can swap it in by content-type.
const JsResponseBodyPayloadGenerator = class {
    body: string;

    constructor(body: string) {
        this.body = body;
    }

    private _isEscaped(pos: number): boolean {
        let count = 0;
        for (let i = pos - 1; i >= 0 && this.body[i] === "\\"; i -= 1) {
            count += 1;
        }
        return count % 2 === 1;
    }

    // Lexical state at `index`: the enclosing quote char, "comment" inside a // or /* */
    // comment, or "" when the position is in code. Regex literals are not tracked; an
    // escaped "/" (as in /a\/\//) is never taken as a comment start.
    private _lexStateAt(index: number): string {
        const body = this.body;
        let state = "";
        for (let i = 0; i < index && i < body.length; i += 1) {
            const ch = body[i];
            if (state === "//") {
                if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") state = "";
            } else if (state === "/*") {
                if (ch === "*" && body[i + 1] === "/") { state = ""; i += 1; }
            } else if (state !== "") {
                if (ch === state && !this._isEscaped(i)) state = "";
            } else if (ch === '"' || ch === "'" || ch === "`") {
                if (!this._isEscaped(i)) state = ch;
            } else if (ch === "/" && (body[i + 1] === "/" || body[i + 1] === "*") && !this._isEscaped(i)) {
                state = body[i + 1] === "/" ? "//" : "/*";
                i += 1;
            }
        }
        return state === "//" || state === "/*" ? "comment" : state;
    }

    // Inside a comment the reflection is inert unless a line terminator / "*/" survives,
    // which this probe set does not test, so a comment position yields no context.
    private _contextAt(index: number): string[] {
        const quote = this._lexStateAt(index);
        if (quote === "comment") return [];
        if (quote === "`") return ["jsTemplateLiteral"];
        if (quote === "'") return ["jsInQuote", "jsInSQuote"];
        if (quote === '"') return ["jsInQuote"];
        return ["js"];
    }

    private _safeDecode(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    private _variantsOf(value: string): string[] {
        const set = new Set<string>();
        const once = this._safeDecode(value);
        const twice = this._safeDecode(once);
        const jsEscaped = twice
            .replace(/\\x([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\u\{([0-9a-f]+)\}/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/\\u([0-9a-f]{4})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        [value, once, twice, jsEscaped].forEach((variant) => set.add(variant));
        return Array.from(set);
    }

    public generate(
        sdk: LogSdk,
        reflectedValue: string
    ): { payload: string[]; context: string[] } {
        // Dangerous-only probe set: string/template breakout, code injection, and the
        // "<" + "/" pair used to detect a "</script>" escape (scored high, not critical,
        // for an external script). No benign chars -- any survivor is a real breakout, so
        // the confirmed-breakout gate stays meaningful on noisy ad traffic.
        const payloadSet = new Set<string>(['"', "'", "`", "\\", "(", ")", ";", "<", "/", "{", "}", "$"]);
        const contextSet = new Set<string>();
        const markerBase = this._safeDecode(this._safeDecode(reflectedValue));
        // Servers often echo the value still percent-encoded (e.g. "%2C" inside a URL in a
        // string); without the encoded forms nothing matches and the context falls back to
        // code position ("js") -- the most severe one -- with no evidence for it.
        const candidates = new Set([
            ...this._variantsOf(markerBase), reflectedValue, encodeURIComponent(markerBase),
        ]);
        for (const marker of candidates) {
            if (!marker) continue;
            let idx = -1;
            while ((idx = this.body.indexOf(marker, idx + 1)) !== -1) {
                for (const c of this._contextAt(idx)) contextSet.add(c);
            }
        }
        if (contextSet.size === 0) contextSet.add("js");
        sdk.console.log?.(`[Reflector++] JS payload generation contexts: ${Array.from(contextSet).join(", ")}`);
        return { payload: Array.from(payloadSet), context: Array.from(contextSet) };
    }

    public detect(
        sdk: LogSdk,
        _context: { context: string[] },
        prefix: string,
        payload: string,
        suffix: string
    ): Array<{ char: string; context: string }> {
        const resultContexts = new Set<string>();
        const marker = `${prefix}${payload}${suffix}`;
        if (!marker) return [];
        for (const variant of this._variantsOf(marker)) {
            if (!variant) continue;
            let idx = -1;
            while ((idx = this.body.indexOf(variant, idx + 1)) !== -1) {
                // Classify at the payload char itself, not the prefix.
                for (const c of this._contextAt(idx + prefix.length)) resultContexts.add(c);
            }
        }
        sdk.console.log?.(`[Reflector++] JS detect payload=${payload} contexts=${Array.from(resultContexts).join(", ")}`);
        return Array.from(resultContexts).map((ctx) => ({ char: payload, context: ctx }));
    }

    // Used by the combo (\ + quote) escalation probe: did the marker land in code
    // position (outside any string)?
    public isInScriptOutsideString(marker: string): boolean {
        const idx = this.body.indexOf(marker);
        if (idx === -1) return false;
        return this._lexStateAt(idx) === "";
    }
};

export default JsResponseBodyPayloadGenerator;
