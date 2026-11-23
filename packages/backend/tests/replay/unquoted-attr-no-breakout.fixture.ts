import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a value echoed into an
// unquoted attribute where the server strips whitespace, "<" and ">". "=", ";" and quotes
// survive but cannot end an unquoted value, so the reflection is sealed. It used to score
// medium (the context default) as a confirmed finding.
const fixture: ReplayFixture = {
  name: "unquoted-attr-no-breakout",
  request: { query: "iid=4b71a595-3d58", host: "shop.example.com", path: "/challenge" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><input type=hidden id=_iid value=4b71a595-3d58><p>ok</p></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "iid",
    bodyTemplate: `<html><body><input type=hidden id=_iid value=__REFLECT__><p>ok</p></body></html>`,
    escape: { custom: (v) => v.replace(/[\s<>]/g, "") },
  },
};

export default fixture;
