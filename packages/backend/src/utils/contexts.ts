// Context classification helpers migrated from legacy utils.ts

export const isLiteralContext = (ctx: string): boolean => {
  if (!ctx) return false;
  const k = ctx.toLowerCase();
  if (k.endsWith('escaped')) return false; // escaped variants (attributeEscaped, eventHandlerEscaped)
  if (k === 'jsonscript') return false;
  return true;
};

export const allowedDetectionContextsFor = (bestContext: string): Set<string> => {
  const c = (bestContext || '').toLowerCase();
  if (c.includes('json script block') || c.includes('json block')) return new Set(['jsonInQuote', 'json']);
  if (c.includes('script string') || c === 'script' || c.includes('script')) return new Set(['jsInQuote', 'js']);
  if (c.includes('style attribute')) return new Set(['styleAttrInQuote', 'styleAttr']);
  if (c.includes('style string') || c === 'style' || c.includes('style')) return new Set(['cssInQuote', 'css']);
  if (c.includes('event handler')) return new Set(['eventHandlerAttrInQuote', 'eventHandlerAttr', 'eventHandler']);
  if (c.includes('url attribute')) return new Set(['urlAttrInQuote', 'urlAttr']);
  if (c.includes('css url')) return new Set(['cssUrl']);
  if (c.includes('srcset')) return new Set(['srcsetUrlInQuote', 'srcsetUrl']);
  if (c.includes('meta refresh')) return new Set(['metaRefresh']);
  if (c.includes('iframe srcdoc') || c.includes('srcdoc')) return new Set(['srcdocHtmlInQuote', 'srcdocHtml']);
  if (c.includes('template html') || c === 'template') return new Set(['templateHtml']);
  if (c.includes('html comment') || c.includes('comment')) return new Set(['htmlComment']);
  if (c.includes('tag attribute') || c.includes('attribute')) return new Set(['attributeInQuote', 'attribute']);
  if (c === 'html' || c.includes('body')) return new Set(['html']);
  return new Set<string>();
};
