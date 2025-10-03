import { RequestParameter } from '../core/types.js';

export const queryToString = (query: { [key: string]: string }) =>
  Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&');

export const parseQueryString = (query: string): { [key: string]: string } => {
  const params: Record<string, string> = {};
  if (!query) return params;
  for (const param of query.split('&')) {
    if (!param) continue;
    const [name, value = ''] = param.split('=');
    if (name) params[decodeURIComponent(name)] = decodeURIComponent(value);
  }
  return params;
};

// Mutate a specific parameter value in a RequestSpec (URL query, JSON body, or form body)
export const mutateParamValue = (
  requestSpec: any,
  param: RequestParameter,
  newValue: string,
  sdk: { console: { log: (msg: string) => void } }
) => {
  try {
    if (param.source === 'Cookie') {
      const raw = requestSpec.getHeader?.('Cookie')?.join('; ') ?? '';
      if (!raw) return;
      const parts = raw.split(';').map((c: string) => c.trim()).filter(Boolean);
      let mutated = false;
      const updated = parts.map((p: string) => {
        const eq = p.indexOf('='); if (eq === -1) return p;
        const k = p.slice(0, eq).trim();
        if (k === param.key) { mutated = true; return `${k}=${newValue}`; }
        return p;
      });
      if (mutated) requestSpec.setHeader?.('Cookie', updated.join('; '));
      return;
    }
    if (param.source === 'URL') {
      const query = parseQueryString(requestSpec.getQuery());
      if (param.key in query) {
        query[param.key] = newValue;
        requestSpec.setQuery(queryToString(query));
      }
      return;
    }
    if (param.source === 'Body' && requestSpec.getBody()) {
      const bodyText = requestSpec.getBody()?.toText();
      if (!bodyText) return;
      const form = parseQueryString(bodyText);
      if (param.key in form) {
        form[param.key] = newValue;
        requestSpec.setBody(queryToString(form));
      }
    }
  } catch (e) {
    sdk.console.log(`[Reflector++] mutateParamValue error: ${e}`);
  }
};
