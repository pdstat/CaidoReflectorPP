import type { SDK } from "@caido/sdk-workflow";

const JsonResponseBodyPayloadGenerator = class {
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

    private _isInsideJsonString(index: number): boolean {
        let inString = false;
        for (let i = 0; i < index && i < this.body.length; i += 1) {
            const ch = this.body[i];
            if (ch === "\"" && !this._isEscaped(i)) {
                inString = !inString;
            }
        }
        return inString;
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
        const htmlDecoded = twice
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&amp;/gi, "&")
            .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(parseInt(digits, 10)))
            .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        const jsEscaped = twice
            .replace(/\\x([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\u\{([0-9a-f]+)\}/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\([0-3]?[0-7]{1,2})/g, (_match, oct: string) => String.fromCharCode(parseInt(oct, 8)));
        const htmlJsDecoded = jsEscaped
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&amp;/gi, "&");
        [value, once, twice, htmlDecoded, jsEscaped, htmlJsDecoded].forEach((variant) => set.add(variant));
        return Array.from(set);
    }

    private _recordContext(index: number, contextSet: Set<string>): void {
        const ctx = this._isInsideJsonString(index) ? "jsonString" : "jsonStructure";
        contextSet.add(ctx);
    }

    public generate(
        sdk: SDK | { console: { log: (msg: string) => void } },
        reflectedValue: string
    ): { payload: string[]; context: string[] } {
        /**
         * Analyze the stored JSON body for the supplied reflected value.
         * Input: the original response body and the value that appeared back in it.
         * We decode the value twice and consider HTML/JS encoded variants so matches
         * work even when the server normalizes or escapes characters.
         * Output: a list of payload characters (quotes, commas, braces, etc.)
         * and contexts ("jsonString" when inside "..." or "jsonStructure" otherwise)
         * that downstream probing can use to attempt context breakouts.
         * Example: body `{ "key": "REF" }` + reflectedValue "REF" returns
         * payloads like `"` and `\` with context `jsonString`.
         */
        const payloadSet = new Set<string>(["\"", ",", "}", "]", ":"]);
        const contextSet = new Set<string>();
        const markerBase = this._safeDecode(this._safeDecode(reflectedValue));
        for (const marker of this._variantsOf(markerBase)) {
            if (!marker) continue;
            let idx = -1;
            while ((idx = this.body.indexOf(marker, idx + 1)) !== -1) {
                this._recordContext(idx, contextSet);
            }
        }
        if (contextSet.has("jsonString")) {
            payloadSet.add("\\");
        }
        if (contextSet.size === 0) {
            contextSet.add("jsonStructure");
        }
        sdk.console.log?.(`[Reflector++] Json payload generation contexts: ${Array.from(contextSet).join(", ")}`);
        return { payload: Array.from(payloadSet), context: Array.from(contextSet) };
    }

    public detect(
        sdk: SDK | { console: { log: (msg: string) => void } },
        context: { context: string[] },
        prefix: string,
        payload: string,
        suffix: string
    ): Array<{ char: string; context: string }> {
        /**
         * Try to find the specific prefix+payload+suffix marker within the JSON body.
         * Input: the desired contexts to check (e.g. ["jsonString"]), and the joined
         * string that represents how a probe would appear when reflected (`prefix+payload+suffix`).
         * Output: each matching context with the payload character so the caller knows
         * whether `payload` landed inside a JSON string or in the structural JSON text.
         * Example: body `{ "count": REF }` with prefix "", payload "REF", suffix "}"
         * returns { context: "jsonStructure", char: "REF" }.
         */
        sdk.console.log?.(`[Reflector++] Json detect looking for payload=${payload} with prefix=${prefix} and suffix=${suffix}`);
        const requested = new Set(context.context);
        const resultContexts = new Set<string>();
        const marker = `${prefix}${payload}${suffix}`;
        if (!marker) {
            return [];
        }
        for (const variant of this._variantsOf(marker)) {
            if (!variant) continue;
            let idx = -1;
            while ((idx = this.body.indexOf(variant, idx + 1)) !== -1) {
                const ctx = this._isInsideJsonString(idx) ? "jsonString" : "jsonStructure";
                if (requested.size === 0 || requested.has(ctx)) {
                    resultContexts.add(ctx);
                }
            }
        }
        sdk.console.log?.(`[Reflector++] Json detect payload=${payload} contexts=${Array.from(resultContexts).join(", ")}`);
        return Array.from(resultContexts).map((ctx) => ({ char: payload, context: ctx }));
    }
};

export default JsonResponseBodyPayloadGenerator;