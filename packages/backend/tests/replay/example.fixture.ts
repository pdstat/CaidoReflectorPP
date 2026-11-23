import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic worked example (no real-target data): a URL param reflected unescaped inside a
// double-quoted JS string in an inline <script>. The server escapes nothing, so a probed
// quote breaks out of the string -> confirmed, Script String context, critical.
//
// Real captures live under fixtures/real/ (gitignored). This committed example documents
// the fixture shape and exercises the harness end-to-end in CI.
const fixture: ReplayFixture = {
  name: "example-js-string-unescaped",
  request: { query: "u=refval123", method: "GET", host: "example.com", path: "/cfg" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<script>var cfg = {"u":"refval123"};</script>`,
  },
  reflection: {
    source: "URL",
    param: "u",
    bodyTemplate: `<script>var cfg = {"u":"__REFLECT__"};</script>`,
    // Server reflects verbatim -- nothing escaped.
    escape: { default: "raw" },
  },
};

export default fixture;
