import type { SDK } from "@caido/sdk-workflow";

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

    // Quote char enclosing `index`, or "" when the position is in code.
    private _stringQuoteAt(index: number): string {
        let quote = "";
        for (let i = 0; i < index && i < this.body.length; i += 1) {
            const ch = this.body[i];
            if (ch !== '"' && ch !== "'" && ch !== "`") continue;
            if (this._isEscaped(i)) continue;
            if (quote === "") quote = ch;
            else if (quote === ch) quote = "";
        }
        return quote;
    }

    private _contextAt(index: number): string[] {
        const quote = this._stringQuoteAt(index);
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
        sdk: SDK | { console: { log: (msg: string) => void } },
        reflectedValue: string
    ): { payload: string[]; context: string[] } {
        // Dangerous-only probe set: string/template breakout, code injection, and the
        // "<" + "/" pair used to detect a "</script>" escape (scored high, not critical,
        // for an external script). No benign chars -- any survivor is a real breakout, so
        // the confirmed-breakout gate stays meaningful on noisy ad traffic.
        const payloadSet = new Set<string>(['"', "'", "`", "\\", "(", ")", ";", "<", "/", "{", "}", "$"]);
        const contextSet = new Set<string>();
        const markerBase = this._safeDecode(this._safeDecode(reflectedValue));
        for (const marker of this._variantsOf(markerBase)) {
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
        sdk: SDK | { console: { log: (msg: string) => void } },
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
        return this._stringQuoteAt(idx) === "";
    }
};

export default JsResponseBodyPayloadGenerator;
