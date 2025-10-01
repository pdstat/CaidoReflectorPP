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
      const contentType = requestSpec.getHeader('Content-Type');
      if (contentType && contentType[0]?.includes('application/json')) {
        try {
          const json = JSON.parse(bodyText);
          const path = param.key.split('.').filter(Boolean);
          if (path.length) {
            let cursor: any = json;
            for (let i = 0; i < path.length - 1; i++) {
              if (typeof cursor[path[i]] !== 'object' || cursor[path[i]] === null) { cursor = null; break; }
              cursor = cursor[path[i]];
            }
            if (cursor) {
              const last = path[path.length - 1];
              if (Object.prototype.hasOwnProperty.call(cursor, last)) {
                cursor[last] = newValue;
                requestSpec.setBody(JSON.stringify(json));
                return;
              }
            }
          }
        } catch { /* ignore JSON issues */ }
      }
      // fallback form-urlencoded
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
