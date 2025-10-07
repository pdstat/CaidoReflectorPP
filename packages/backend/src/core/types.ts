// Central type definitions for the reflector++ workflow
// Incremental extraction: only the two primary public interfaces for now.

export type ParamSource = "URL" | "Cookie" | "Body";

export interface ReflectedParameter {
  name: string;
  matches: Array<[number, number]>; // [start, end] index positions in response body (synthetic for headers)
  context: string;                  // best contextual classification
  aggressive?: string[];            // successfully reflected probe characters (payload set)
  source?: ParamSource;             // where the parameter originated
  headers?: string[];               // reflected response header names (if header reflection)
  certainty: number;                // heuristic 0-100 confidence / risk score
}

// Extended analyzed reflected parameter including optional scoring metadata.
export interface AnalyzedReflectedParameter extends ReflectedParameter {
  confidence?: number;
  severity?: number;
  score?: number; // alias; some callers used 'score' alongside 'certainty'
  otherContexts?: Record<string, number>;
}

export interface RequestParameter {
  key: string;            // parameter name (query key, form key, cookie name, JSON path)
  value: string | undefined; // raw value (may be undefined if absent/empty)
  source: ParamSource;    // origin bucket
  method: string;         // HTTP method when captured
  code: number;           // response status code when enumerated (0 if unknown)
}
