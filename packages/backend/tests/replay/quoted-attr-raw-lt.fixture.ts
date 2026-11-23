import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a value echoed into a
// double-quoted attribute where the server entity-encodes quotes and "&" but leaves "<" and ">"
// raw. The attribute is sealed ("<" cannot open a tag inside a value), but the raw-body
// fallback used to count the occurrence as HTML text and escalate it to "HTML" high.
const fixture: ReplayFixture = {
  name: "quoted-attr-raw-lt",
  request: { query: "ref=summer-sale", host: "shop.example.com", path: "/landing" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><input type="hidden" name="ref" value="summer-sale"><p>Welcome</p></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "ref",
    bodyTemplate: `<html><body><input type="hidden" name="ref" value="__REFLECT__"><p>Welcome</p></body></html>`,
    escape: { default: "raw", map: { '"': "htmlentity", "'": "htmlentity", "&": "htmlentity" } },
  },
};

export default fixture;
