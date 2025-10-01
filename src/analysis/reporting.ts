import { ReflectedParameter as BaseReflectedParameter } from "../core/types.js";
import { mergeEncodedSignals } from "./mergeEncodedSignals.js";
import { prettyPrintContext } from "./contextMap.js";

/**
 * Extended reflected parameter interface to include scoring & auxiliary fields
 * added at runtime during analysis.
 */
export interface ReportReflectedParameter extends BaseReflectedParameter {
  confidence?: number;
  severity?: number;
  score?: number;          // alias for certainty/total scoring percentage
  otherContexts?: Record<string, number>; // optional: secondary literal contexts
  headers?: string[];      // for header reflections
  aggressive?: string[];   // allowed characters (literal proven)
}

/** Canonicalize internal context identifiers into human readable labels */
export function canonicalizeContext(ctx?: string): string | undefined {
  if (!ctx) return undefined;
  return prettyPrintContext(ctx);
}

function formatOtherContexts(other?: Record<string, number>): string | undefined {
  if (!other) return undefined;
  const items = Object.entries(other)
    .filter(([k, c]) => k && c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `${canonicalizeContext(k) ?? k} ×${c}`);
  return items.length ? `; also in ${items.join(", ")}` : undefined;
}

/** Build a per-parameter report block (string) */
export function generateReport(param: ReportReflectedParameter): string {
  const { name, matches, context, aggressive, source, headers } = param;
  const prettyContext = canonicalizeContext(context);
  const alsoIn = formatOtherContexts(param.otherContexts);
  const count = Array.isArray(matches) ? matches.length : 0;
  const total = (param as any).score ?? (param as any).certainty;
  const conf = param.confidence;
  const sev = param.severity;
  const scoreParts: string[] = [];
  if (typeof total === "number") scoreParts.push(`score=${Math.round(total)}%`);
  if (typeof conf === "number") scoreParts.push(`confidence=${Math.round(conf)}%`);
  if (typeof sev === "number") scoreParts.push(`severity=${Math.round(sev)}%`);
  let details = `${name} – reflected ${count} time(s)`;
  if (prettyContext) details += ` in ${prettyContext}`;
  if (alsoIn) details += alsoIn;
  if (headers && headers.length) details += ` in header(s): ${headers.join(", ")}`;
  if (source) details += ` (source: ${source})`;
  if (scoreParts.length) details += ` [${scoreParts.join(", ")}]`;
  details += `\n`;
  if (aggressive && aggressive.length) {
    details += `\n  Allowed characters (literal, verified in this context):`;
    for (const ch of aggressive) {
      const shown = ch === "" ? "<empty>" : JSON.stringify(ch);
      details += `\n    - ${shown}`;
    }
    details += `\n`;
  }
  return details;
}

/** Merge encoded signal entries (duplicates by name) into summary lines */
export function buildEncodedSignalsSection(encodedSignals: Array<{ name: string; source: string; contexts: string[]; evidence: string[]; count: number; }> | undefined): string {
  if (!encodedSignals?.length) return "";
  const merged = mergeEncodedSignals(encodedSignals);
  let out = "\nEncoded reflections (informational):\n";
  for (const { name, contexts, evidence, count } of merged.values()) {
    out += `- ${name} → ${Array.from(contexts).join(", ")} (matches≈${count}; evidence: ${Array.from(evidence).join(", ")})\n`;
  }
  return out;
}
