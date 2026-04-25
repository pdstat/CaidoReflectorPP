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
        if (ctxArr.includes('jsTemplateLiteral')) bestContext = 'JS Template Literal';
        else if (ctxArr.includes('jsUri')) bestContext = 'JavaScript URI';
        else if (ctxArr.includes('jsInQuote')) {
            bestContext = ctxArr.includes('jsInSQuote')
                ? "Script String (')"
                : 'Script String (")';
        }
        else if (ctxArr.includes('js')) bestContext = 'Script';
        else if (ctxArr.includes('importMapString')) bestContext = 'Import Map String';
        else if (ctxArr.includes('importMap')) bestContext = 'Import Map';
        else if (ctxArr.includes('jsonString')) bestContext = 'JSON String';
        else if (ctxArr.includes('cssInQuote')) bestContext = 'Style String (")';
        else if (ctxArr.includes('css')) bestContext = 'Style';
        else if (ctxArr.includes('jsonStructure')) bestContext = 'JSON Structure';
        else if (ctxArr.includes('eventHandlerAttrInQuote')) bestContext = 'Event Handler Attribute (quoted)';
        else if (ctxArr.includes('eventHandlerAttr')) bestContext = 'Event Handler Attribute (unquoted)';
        else if (ctxArr.includes('eventHandler')) bestContext = 'Event Handler Attribute';
        else if (ctxArr.includes('dataUri')) bestContext = 'Data URI';
        else if (ctxArr.includes('urlAttrInQuote')) bestContext = 'URL Attribute (quoted)';
        else if (ctxArr.includes('urlAttr')) bestContext = 'URL Attribute (unquoted)';
        else if (ctxArr.includes('cssUrl')) bestContext = 'CSS url()';
        else if (ctxArr.includes('styleAttrInQuote')) bestContext = 'Style Attribute (quoted)';
        else if (ctxArr.includes('styleAttr')) bestContext = 'Style Attribute (unquoted)';
        else if (ctxArr.includes('srcsetUrlInQuote')) bestContext = 'Srcset Attribute (quoted)';
        else if (ctxArr.includes('srcsetUrl')) bestContext = 'Srcset Attribute (unquoted)';
        else if (ctxArr.includes('metaRefresh')) bestContext = 'Meta Refresh URL';
        else if (ctxArr.includes('srcdocHtmlInQuote')) bestContext = 'Iframe Srcdoc (quoted)';
        else if (ctxArr.includes('srcdocHtml')) bestContext = 'Iframe Srcdoc (unquoted)';
        else if (ctxArr.includes('templateHtml')) bestContext = 'Template HTML';
        else if (ctxArr.includes('jsonInQuote')) bestContext = 'JSON Script Block (string)';
        else if (ctxArr.includes('json')) bestContext = 'JSON Script Block';
        else if (ctxArr.includes('attributeInQuote')) {
            bestContext = ctxArr.includes('attrInSQuote')
                ? "Tag Attribute (') Value"
                : ctxArr.includes('attrInDQuote')
                    ? 'Tag Attribute (") Value'
                    : 'Tag Attribute (quoted) Value';
        }
        else if (ctxArr.includes('attribute')) bestContext = 'Tag Attribute (unquoted) Value';
        else if (ctxArr.includes('domClobber')) bestContext = 'DOM Clobbering (id/name)';
        else if (ctxArr.includes('attributeEscaped')) bestContext = 'Tag Attribute (encoded)';
        else if (ctxArr.includes('svgContext')) bestContext = 'SVG Context';
        else if (ctxArr.includes('mathContext')) bestContext = 'MathML Context';
        else if (ctxArr.includes('rawtextElement')) bestContext = 'RAWTEXT/RCDATA Element';
        else if (ctxArr.includes('htmlBaseInjection')) bestContext = 'HTML (Base Tag Injection)';
        else if (ctxArr.includes('htmlComment')) bestContext = 'HTML Comment';
        else if (ctxArr.includes('html')) bestContext = 'HTML';
    }
    return bestContext;
}
