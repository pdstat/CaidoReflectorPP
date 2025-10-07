import { ReflectedParameter as BaseReflectedParameter } from "../core/types.js";
import { ScoreResult, ScoreDelta } from "./scoring.js";
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
  // Extended scoring (if caller passed full ScoreResult alongside legacy fields)
  categories?: ScoreResult['categories'];
  rationale?: ScoreResult['rationale'];
  modelVersion?: string;
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
  const total = (param as any).score ?? (param as any).certainty; // numeric value
  const conf = param.confidence;
  const sev = param.severity;
  const categories = param.categories;
  // Compact main line per requirement E
  // token: 2 reflections | Context: Tag Attribute (encoded) | Score: 71% (strong) [Conf 55% (high), Sev 100% (critical)]
  let line = `${name}: ${count} reflection${count === 1 ? '' : 's'}`;
  if (prettyContext) line += ` | Context: ${prettyContext}`;
  if (alsoIn) line += ` ${alsoIn}`; // retains "; also in ..." text
  if (headers && headers.length) line += ` | Headers: ${headers.join(', ')}`;
  if (typeof total === 'number') {
    const totalPct = Math.round(total);
    const totalCat = categories?.total ? ` (${categories.total})` : '';
    line += ` | Score: ${totalPct}%${totalCat}`;
  }
  const parts: string[] = [];
  if (typeof conf === 'number') parts.push(`Conf ${Math.round(conf)}%${categories?.confidence ? ` (${categories.confidence})` : ''}`);
  if (typeof sev === 'number') parts.push(`Sev ${Math.round(sev)}%${categories?.severity ? ` (${categories.severity})` : ''}`);
  if (parts.length) line += ` [${parts.join(', ')}]`;
  if (source) line += ` | Source: ${source}`;
  if (param.modelVersion) line += ` | Model ${param.modelVersion}`;
  line += `\n`;

  // Rationale (compact, always shown when available — no verbose toggle implemented)
  const rat = param.rationale;
  if (rat) {
    const fmtGroup = (label: string, arr: ScoreDelta[] | undefined) => {
      if (!arr || !arr.length) return '';
      const lines = arr.map(d => {
        const sign = d.delta >= 0 ? '+' : '';
        return `    - ${d.label}: ${sign}${d.delta}`;
      });
      return `  ${label}:\n${lines.join('\n')}\n`;
    };
    line += fmtGroup('Confidence factors', rat.confidence);
    line += fmtGroup('Severity factors', rat.severity);
    line += fmtGroup('Penalties / clamps', rat.penalties);
  }

  let details = line;
  if (aggressive && aggressive.length) {
    details += `  Allowed characters (literal, verified in this context):`;
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
