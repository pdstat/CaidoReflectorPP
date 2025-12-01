// Context resolution helpers extracted from bodyReflection.ts
// Converts raw detection arrays and baseline matches into a user-facing best context label.

import { getReflectionContext } from "./context.js";

export function resolveBestContext(
    baselineMatches: Array<[number, number]>,
    bodyText: string,
    tags: any,
    contextInfo: any
): string {
    let bestContext = getReflectionContext(baselineMatches, bodyText, tags as any);
    if (contextInfo && contextInfo.context) {
        const ctxArr = contextInfo?.context ?? [];
        if (ctxArr.includes('jsInQuote')) bestContext = 'Script String (")';
        else if (ctxArr.includes('js')) bestContext = 'Script';
        else if (ctxArr.includes('jsonString')) bestContext = 'JSON String';
        else if (ctxArr.includes('cssInQuote')) bestContext = 'Style String (")';
        else if (ctxArr.includes('css')) bestContext = 'Style';
        else if (ctxArr.includes('jsonStructure')) bestContext = 'JSON Structure';
        else if (ctxArr.includes('eventHandler')) bestContext = 'Event Handler Attribute';
        else if (ctxArr.includes('attributeInQuote')) bestContext = 'Tag Attribute (quoted) Value';
        else if (ctxArr.includes('attribute')) bestContext = 'Tag Attribute (unquoted) Value';
        else if (ctxArr.includes('attributeEscaped')) bestContext = 'Tag Attribute (encoded)';
        else if (ctxArr.includes('html')) bestContext = 'HTML';
    }
    return bestContext;
}
