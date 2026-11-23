import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a value reflected into a
// double-quoted JSON string inside an inline <script>, where the serializer escapes `"`, `\`
// and the "</" sequence (as \u003C/) but leaves a lone "<" and "/" raw. Per-char probes see
// "<" and "/" survive and used to infer a "</script>" breakout (critical); the sequence
// itself never survives, so the string is sealed.
const fixture: ReplayFixture = {
  name: "script-string-close-sequence-escaped",
  request: { query: "_from=R40&_nkw=shoes", host: "shop.example.com", path: "/sch/i.html" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><script>var cfg={"params":{"_from":"R40"}};</script></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "_from",
    bodyTemplate:
      `<html><body><script>var cfg={"params":{"_from":"__REFLECT__"}};</script></body></html>`,
    escape: {
      default: "raw",
      map: { '"': "backslash", "\\": "backslash" },
      sequences: { "</": "\\u003C/" },
    },
  },
};

export default fixture;
