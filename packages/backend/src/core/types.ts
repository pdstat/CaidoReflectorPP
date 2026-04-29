export type ParamSource = "URL" | "UrlJson" | "Cookie" | "Body" | "BodyJson" | "Header" | "Path";

export type SeverityTier = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type RedirectPosition =
  | 'full-url' | 'scheme' | 'host' | 'subdomain'
  | 'path' | 'query' | 'fragment' | 'unknown';

export const SEVERITY_ORDER: Record<SeverityTier, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4
};

export interface ReflectedParameter {
  name: string;
  matches: Array<[number, number]>;
  context: string;
  aggressive?: string[];
  source?: ParamSource;
  headers?: string[];
  value?: string;
  severity: SeverityTier;
  confirmed: boolean;
  redirectPosition?: RedirectPosition;
}

export interface AnalyzedReflectedParameter extends ReflectedParameter {
  otherContexts?: Record<string, number>;
}

export interface RequestParameter {
  key: string;
  value: string | undefined;
  source: ParamSource;
  method: string;
  code: number;
  parentKey?: string;
  jsonPath?: string[];
}
