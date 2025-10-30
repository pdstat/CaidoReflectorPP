import { ConfigStore } from "../stores/configStore.js";

// Build a canonical endpoint string. Some callers may pass a request wrapper that only exposes
// toSpec(); in that case unwrap before reading connection details.
export const buildEndpoint = (obj: any) => {
  let target = obj;
  if (target && typeof target.getTls !== 'function' && typeof target.toSpec === 'function') {
    try { target = target.toSpec(); } catch { /* ignore */ }
  }
  const getTls = typeof target.getTls === 'function' ? target.getTls() : false;
  const host = typeof target.getHost === 'function' ? target.getHost() : '';
  const path = typeof target.getPath === 'function' ? target.getPath() : '';
  return (getTls ? 'https://' : 'http://') + host + path;
};

// Content-type gating (HTML-like or sniffable with missing headers)
export const passesContentTypeGating = (
  rawContentType: string | string[] | undefined,
  rawNoSniff: string | string[] | undefined
): boolean => {
  let normalizedCT: string | undefined;
  if (Array.isArray(rawContentType)) normalizedCT = rawContentType.find(v => v && v.trim() !== '');
  else if (typeof rawContentType === 'string' && rawContentType.trim() !== '') normalizedCT = rawContentType;
  const noSniffContentTypes = ConfigStore.getNoSniffContentTypes();
  const ctValue = normalizedCT?.split(';')[0].toLowerCase();
  const htmlLike = !!ctValue && noSniffContentTypes.has(ctValue);

  let nosniffLower: string | undefined;
  if (Array.isArray(rawNoSniff)) nosniffLower = rawNoSniff.join(',').toLowerCase();
  else if (typeof rawNoSniff === 'string') nosniffLower = rawNoSniff.toLowerCase();
  const hasNoSniff = !!nosniffLower && nosniffLower.includes('nosniff');
  const missingCtAndNoNoSniff = !normalizedCT && !hasNoSniff;
  return htmlLike || missingCtAndNoNoSniff;
};
