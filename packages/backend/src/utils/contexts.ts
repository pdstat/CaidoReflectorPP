// Context classification helpers migrated from legacy utils.ts

export const isLiteralContext = (ctx: string): boolean => {
  if (!ctx) return false;
  const k = ctx.toLowerCase();
  if (k.endsWith('escaped')) return false; // escaped variants (attributeEscaped, eventHandlerEscaped)
  if (k.includes('comment')) return false; // htmlComment
  if (k === 'jsonscript') return false;
  return true;
};

export const allowedDetectionContextsFor = (bestContext: string): Set<string> => {
  const c = (bestContext || '').toLowerCase();
  if (c.includes('script string') || c === 'script' || c.includes('script')) return new Set(['jsInQuote', 'js']);
  if (c.includes('style string') || c === 'style' || c.includes('style')) return new Set(['cssInQuote', 'css']);
  if (c.includes('event handler')) return new Set(['eventHandler']);
  if (c.includes('tag attribute') || c.includes('attribute')) return new Set(['attributeInQuote', 'attribute']);
  if (c === 'html' || c.includes('body')) return new Set(['html']);
  return new Set<string>();
};
