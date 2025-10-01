// Shared interface for tracked parameters used across stores
export interface TrackedParam {
  key: string;
  value?: string;
  source: string; // e.g. URL | Cookie | Body
  method: string; // HTTP method (GET/POST/...)
  code: number; // Response status code observed when captured
}
