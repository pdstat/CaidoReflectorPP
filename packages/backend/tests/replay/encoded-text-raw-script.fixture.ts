import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a search term echoed
// raw-ish inside an inline-script JSON string (" and \ backslash-escaped, "</" escaped)
// AND entity-encoded in HTML flow text. The parser's entity-DECODED text used to make
// "&lt;" look like a literal "<", so the sealed string escalated to an "HTML" high.
const fixture: ReplayFixture = {
  name: "encoded-html-text-raw-script-string",
  request: { query: "q=shoes", host: "shop.example.com", path: "/search" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><h1>Results for <span class="kw">shoes</span></h1>`
      + `<script>var cfg={"keyword":"shoes"};</script></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "q",
    bodyTemplate: `<html><body><h1>Results for <span class="kw">__REFLECT_HTML__</span></h1>`
      + `<script>var cfg={"keyword":"__REFLECT__"};</script></body></html>`,
    escape: {
      default: "raw",
      map: { '"': "backslash", "\\": "backslash" },
      sequences: { "</": "\\u003C/" },
    },
    extraSentinels: {
      __REFLECT_HTML__: {
        default: "raw",
        map: { "<": "htmlentity", ">": "htmlentity", "&": "htmlentity", '"': "htmlentity", "'": "htmlentity" },
      },
    },
  },
};

export default fixture;
