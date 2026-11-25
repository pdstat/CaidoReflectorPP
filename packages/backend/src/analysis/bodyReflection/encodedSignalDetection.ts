// Encoded-only reflection detection logic extracted from bodyReflection.ts
// Identifies URL-encoded, HTML-entity, or JSON (\uXXXX) reflected variants when no literal echo is present.

import { encVariants, findMatches } from "../../utils/text.js";
import { addEncodedSignal } from "../encodedSignalsStore.js";
import { CONTEXT } from "../contextMap.js";

type SDK = any;

// Decodes JSON \uXXXX escapes. An escaped backslash (\\) is kept as is, so "\\u0041" stays
// the literal text \u0041 rather than becoming "A".
function decodeJsonUnicodeEscapes(s: string): string {
    return s.replace(/\\(\\|u([0-9a-fA-F]{4}))/g, (m: string, _esc: string, hex?: string) =>
        hex ? String.fromCharCode(parseInt(hex, 16)) : m);
}

export function detectEncodedOnly(
    sdk: SDK,
    input: any,
    paramKey: string,
    paramSource: string,
    paramValue: string,
    bodyText: string
): boolean { // returns true if encoded-only signal recorded
    const { url, html } = encVariants(paramValue);
    const urlHitCount = findMatches(bodyText, url, false, sdk).length;
    const htmlHitCount = findMatches(bodyText, html, false, sdk).length;
    let jsonUniHitCount = 0;
    const jsonScriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = jsonScriptRegex.exec(bodyText)) !== null) {
        // The value has no literal echo anywhere in the body (the caller checked), so a match
        // in the unescaped JSON is an echo that went through at least one \uXXXX escape.
        const txt = m[1] || "";
        const decoded = decodeJsonUnicodeEscapes(txt);
        if (decoded !== txt) jsonUniHitCount += findMatches(decoded, paramValue, false, sdk).length;
    }
    if (urlHitCount || htmlHitCount || jsonUniHitCount) {
        const contexts: string[] = []; const evidence: string[] = [];
        if (urlHitCount) {
            contexts.push(CONTEXT.ATTRIBUTE_ESCAPED);
            evidence.push('%xx');
        }
        if (htmlHitCount) {
            contexts.push(CONTEXT.ATTRIBUTE_ESCAPED);
            evidence.push('&quot/&lt/&gt/&amp');
        }
        if (jsonUniHitCount) {
            contexts.push(CONTEXT.JSON_ESCAPED);
            evidence.push('\\uXXXX');
        }
        addEncodedSignal(input, { name: paramKey, source: paramSource, contexts, evidence, count: urlHitCount + htmlHitCount + jsonUniHitCount });
        sdk.console.log(`[Reflector++] Encoded-only echo recorded for "${paramKey}" (${contexts.join(', ')})`);
        return true;
    }
    return false;
}
