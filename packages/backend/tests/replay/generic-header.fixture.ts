import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case for the FP class fixed in this iteration: a value reflected into a generic,
// non-security response header (Timing-Allow-Origin). Even though breakout chars survive, a
// generic header reflection is not an XSS/injection vector, so it must score LOW (previously
// a blanket fallback rated every confirmed header reflection Medium).
const fixture: ReplayFixture = {
  name: "generic-header-timing-allow-origin",
  request: { query: "cb=reflectval123", host: "cdn.example.com", path: "/t" },
  baseline: {
    code: 200,
    headers: { "Timing-Allow-Origin": "https://cdn.example.com/reflectval123" },
  },
  reflection: {
    source: "URL",
    param: "cb",
    headerTemplates: { "Timing-Allow-Origin": "https://cdn.example.com/__REFLECT__" },
    // Non-dangerous chars reflect; CR/LF are stripped (as the HTTP layer would), so there is
    // no response splitting -- the reflection is inert and must score low on its own merits.
    escape: { default: "raw", map: { "\r": "drop", "\n": "drop" } },
  },
};

export default fixture;
