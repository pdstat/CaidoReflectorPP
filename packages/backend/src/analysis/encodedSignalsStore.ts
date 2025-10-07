// Encoded signals store abstraction replacing ad-hoc __encodedSignals property usage.
// Uses a unique symbol to avoid accidental collisions on the input object.

export interface EncodedSignal {
  name: string;
  source: string;
  contexts: string[];
  evidence: string[];
  count: number;
}

const STORE_KEY: unique symbol = Symbol('encodedSignals');

interface WithEncodedSignals {
  [STORE_KEY]?: EncodedSignal[];
}

export function addEncodedSignal(holder: any, signal: EncodedSignal) {
  const target = holder as WithEncodedSignals;
  const bucket = target[STORE_KEY] ?? (target[STORE_KEY] = []);
  bucket.push({
    ...signal,
    contexts: Array.from(new Set(signal.contexts)),
    evidence: Array.from(new Set(signal.evidence))
  });
}

export function getEncodedSignals(holder: any): EncodedSignal[] | undefined {
  return (holder as WithEncodedSignals)[STORE_KEY];
}

export function setEncodedSignals(holder: any, signals: EncodedSignal[]) {
  (holder as WithEncodedSignals)[STORE_KEY] = signals;
}
