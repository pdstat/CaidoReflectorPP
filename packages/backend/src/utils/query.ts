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
    if (param.source === 'UrlJson' && param.parentKey && param.jsonPath?.length) {
      const rawQuery = requestSpec.getQuery() || '';
      const pairs = rawQuery.split('&');
      const rebuilt: string[] = [];
      let mutated = false;
      for (const pair of pairs) {
        const eq = pair.indexOf('=');
        if (eq === -1) { rebuilt.push(pair); continue; }
        let key: string;
        try { key = decodeURIComponent(pair.slice(0, eq)); } catch { rebuilt.push(pair); continue; }
        if (key === param.parentKey && !mutated) {
          let decoded: string;
          const rawVal = pair.slice(eq + 1).replace(/\+/g, ' ');
          try { decoded = decodeURIComponent(rawVal); } catch { rebuilt.push(pair); continue; }
          try {
            const json = JSON.parse(decoded);
            let target = json;
            for (let i = 0; i < param.jsonPath.length - 1; i++) {
              const seg = param.jsonPath[i];
              target = target[/^\d+$/.test(seg) ? parseInt(seg, 10) : seg];
              if (target == null) throw new Error('path not found');
            }
            const last = param.jsonPath[param.jsonPath.length - 1];
            target[/^\d+$/.test(last) ? parseInt(last, 10) : last] = newValue;
            rebuilt.push(
              `${pair.slice(0, eq)}=${encodeURIComponent(JSON.stringify(json))}`
            );
            mutated = true;
          } catch { rebuilt.push(pair); }
        } else {
          rebuilt.push(pair);
        }
      }
      if (mutated) requestSpec.setQuery(rebuilt.join('&'));
      return;
    }
    if (param.source === 'BodyJson' && param.parentKey && param.jsonPath?.length) {
      const bodyText = requestSpec.getBody()?.toText();
      if (!bodyText) return;
      const pairs = bodyText.split('&');
      const rebuilt: string[] = [];
      let mutated = false;
      for (const pair of pairs) {
        const eq = pair.indexOf('=');
        if (eq === -1) { rebuilt.push(pair); continue; }
        let key: string;
        try { key = decodeURIComponent(pair.slice(0, eq)); } catch { rebuilt.push(pair); continue; }
        if (key === param.parentKey && !mutated) {
          let decoded: string;
          const rawVal = pair.slice(eq + 1).replace(/\+/g, ' ');
          try { decoded = decodeURIComponent(rawVal); } catch { rebuilt.push(pair); continue; }
          try {
            const json = JSON.parse(decoded);
            let target = json;
            for (let i = 0; i < param.jsonPath.length - 1; i++) {
              const seg = param.jsonPath[i];
              target = target[/^\d+$/.test(seg) ? parseInt(seg, 10) : seg];
              if (target == null) throw new Error('path not found');
            }
            const last = param.jsonPath[param.jsonPath.length - 1];
            target[/^\d+$/.test(last) ? parseInt(last, 10) : last] = newValue;
            rebuilt.push(
              `${pair.slice(0, eq)}=${encodeURIComponent(JSON.stringify(json))}`
            );
            mutated = true;
          } catch { rebuilt.push(pair); }
        } else {
          rebuilt.push(pair);
        }
      }
      if (mutated) requestSpec.setBody(rebuilt.join('&'));
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
      return;
    }
    if (param.source === 'Header') {
      const headerName = param.key.replace(/^header:/, '');
      requestSpec.setHeader?.(headerName, newValue);
      return;
    }
    if (param.source === 'Path') {
      const parts = param.key.split(':');
      const segIdx = parseInt(parts[1], 10);
      const path = requestSpec.getPath?.() || '';
      const segments = path.split('/');
      let realIdx = 0;
      for (let j = 0; j < segments.length; j++) {
        if (segments[j] === '') continue;
        if (realIdx === segIdx) {
          segments[j] = encodeURIComponent(newValue);
          break;
        }
        realIdx++;
      }
      requestSpec.setPath?.(segments.join('/'));
    }
  } catch (e) {
    sdk.console.log(`[Reflector++] mutateParamValue error: ${e}`);
  }
};
