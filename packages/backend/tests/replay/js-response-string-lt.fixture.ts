import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a standalone JavaScript
// response (a tag-manager container) reflecting an id into double-quoted JSON strings, with
// " and \ escaped. "'" and "<" come back raw, but neither can end a "-string, and "<" is
// inert in a JS response (no HTML parsing), so the reflection is sealed.
const fixture: ReplayFixture = {
  name: "js-response-dquote-string-raw-lt",
  request: { query: "id=G-ABC123XYZ", host: "tags.example.com", path: "/gtag/js" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "application/javascript; charset=UTF-8" },
    body: `var data={"vtp_instanceDestinationId":"G-ABC123XYZ","tag_id":31};(function(){})();`,
  },
  reflection: {
    source: "URL",
    param: "id",
    bodyTemplate: `var data={"vtp_instanceDestinationId":"__REFLECT__","tag_id":31};(function(){})();`,
    escape: { default: "raw", map: { '"': "backslash", "\\": "backslash" } },
  },
};

export default fixture;
