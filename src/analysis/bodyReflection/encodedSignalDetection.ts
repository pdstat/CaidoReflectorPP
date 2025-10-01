// Encoded-only reflection detection logic extracted from bodyReflection.ts
// Identifies URL-encoded, HTML-entity, or JSON (\uXXXX) reflected variants when no literal echo is present.

import { encVariants, findMatches } from "../../utils/text.js";
import { addEncodedSignal } from "../encodedSignalsStore.js";

type SDK = any;

export function detectEncodedOnly(
  sdk: SDK,
  input: any,
  paramKey: string,
  paramSource: string,
  paramValue: string,
  bodyText: string
): boolean { // returns true if encoded-only signal recorded
  const { url, html, jsUniPieces } = encVariants(paramValue);
  const urlHitCount = findMatches(bodyText, url).length;
  const htmlHitCount = findMatches(bodyText, html).length;
  let jsonUniHitCount = 0;
  const jsonScriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null; while ((m = jsonScriptRegex.exec(bodyText)) !== null) { const txt = m[1] || ""; for (const piece of jsUniPieces) { if (txt.includes(piece)) jsonUniHitCount++; } }
  if (urlHitCount || htmlHitCount || jsonUniHitCount) {
    const contexts: string[] = []; const evidence: string[] = [];
    if (urlHitCount) { contexts.push('attributeEscaped'); evidence.push('%xx'); }
    if (htmlHitCount) { contexts.push('attributeEscaped'); evidence.push('&quot/&lt/&gt/&amp'); }
    if (jsonUniHitCount) { contexts.push('jsonEscaped'); evidence.push('\\uXXXX'); }
    addEncodedSignal(input, { name: paramKey, source: paramSource, contexts, evidence, count: urlHitCount + htmlHitCount + jsonUniHitCount });
    sdk.console.log(`[Reflector++] Encoded-only echo recorded for "${paramKey}" (${contexts.join(', ')})`);
    return true;
  }
  return false;
}
