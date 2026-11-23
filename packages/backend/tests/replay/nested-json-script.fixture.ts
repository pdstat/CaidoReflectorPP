import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a value three string
// layers deep (Next.js RSC flight data: a route key inside a JSON tree inside a JS string
// literal), with every layer escaping " and \ correctly and "<" emitted as \u003c. The
// same flight data also carries the URL-encoded query (`urlParts`), so a "\" probe passes
// the reflection gate via "%5C" and the detector then accepts the escaped deep copy. The per-char detector accepts the doubled "\" copy as
// a literal "\", which used to score the sealed string high. The \+quote combo probe stays
// sealed, so "\" is dropped.
const fixture: ReplayFixture = {
  name: "nested-json-in-js-string",
  request: { query: "referrer=%2F", host: "shop.example.com", path: "/error403" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><script>self.__next_f.push([1,"{\\"urlParts\\":[\\"error403?referrer=%2F\\"]}"])</script><script>self.__next_f.push([1,"[\\"__PAGE__?{\\\\\\"referrer\\\\\\":\\\\\\"/\\\\\\"}\\"]"])</script></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "referrer",
    bodyTemplate:
      `<html><body><script>self.__next_f.push([1,"{\\"urlParts\\":[\\"error403?referrer=__REFLECT_URL__\\"]}"])</script><script>self.__next_f.push([1,"[\\"__PAGE__?{\\\\\\"referrer\\\\\\":\\\\\\"__REFLECT__\\\\\\"}\\"]"])</script></body></html>`,
    escape: { default: "raw", jsonStringLayers: 3, sequences: { "<": "\\u003c" } },
    extraSentinels: { __REFLECT_URL__: { default: "percent" } },
  },
};

export default fixture;
