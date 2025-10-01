// Utility to merge encoded signal entries by parameter name.
// Avoids duplication between runtime exploratory mode promotion and reporting formatting.

export interface EncodedSignalEntry {
  name: string;
  source: string;
  contexts: string[];
  evidence: string[];
  count: number;
}

export interface MergedEncodedSignal {
  name: string;
  source: string; // last-seen or first-seen source (kept for potential categorization)
  contexts: Set<string>;
  evidence: Set<string>;
  count: number;
}

export function mergeEncodedSignals(signals: EncodedSignalEntry[] | undefined): Map<string, MergedEncodedSignal> {
  const out = new Map<string, MergedEncodedSignal>();
  if (!signals) return out;
  for (const s of signals) {
    const existing = out.get(s.name);
    if (existing) {
      s.contexts.forEach(c => existing.contexts.add(c));
      s.evidence.forEach(e => existing.evidence.add(e));
      existing.count += s.count;
    } else {
      out.set(s.name, {
        name: s.name,
        source: s.source,
        contexts: new Set(s.contexts),
        evidence: new Set(s.evidence),
        count: s.count
      });
    }
  }
  return out;
}
