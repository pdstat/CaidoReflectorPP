import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FN class fixed in this iteration: a value carried in a raw
// application/json request body, reflected unescaped into a single-quoted JS string in an
// HTML response. Before the fix the plugin never enumerated JSON request bodies, so it
// reported nothing for such a param regardless of how dangerously it reflected.
const fixture: ReplayFixture = {
  name: "json-body-to-js-string",
  request: {
    method: "POST",
    host: "api.example.com",
    path: "/widget",
    contentType: "application/json",
    body: JSON.stringify({ imp: [{ tagid: "fuse-slot-home-1" }] }),
  },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<script>var slot='fuse-slot-home-1';</script>`,
  },
  reflection: {
    source: "BodyJsonRaw",
    param: "body.imp[0].tagid",
    jsonPath: ["imp", "0", "tagid"],
    bodyTemplate: `<script>var slot='__REFLECT__';</script>`,
    escape: { default: "raw" },
  },
};

export default fixture;
