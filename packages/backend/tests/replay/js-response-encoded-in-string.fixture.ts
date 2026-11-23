import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a conversion-tag JS response
// echoes query params percent-encoded inside a single-quoted URL string ("\x26eid\x3d<v>").
// Only "(" and ")" survive (encodeURIComponent leaves them), and they are inert in the string.
// The baseline value contains "," which comes back as "%2C", so the decoded-only variant
// search found nothing and the context fell back to code position ("Script") -> high.
const fixture: ReplayFixture = {
  name: "js-response-encoded-value-in-string",
  request: { query: "fst=1795454305879&eid=375603261%2C466465926", host: "ads.example.com", path: "/pagead/conversion/1/" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/javascript; charset=UTF-8", "X-Content-Type-Options": "nosniff" },
    body: `(function(){})();s.ss_(window,'QQ',['https://ads.example.com/vt/1/?fst\\x3d1795454305879\\x26eid\\x3d375603261%2C466465926\\x26u_h\\x3d1440']);`,
  },
  reflection: {
    source: "URL",
    param: "eid",
    bodyTemplate: `(function(){})();s.ss_(window,'QQ',['https://ads.example.com/vt/1/?fst\\x3d1795454305879\\x26eid\\x3d__REFLECT__\\x26u_h\\x3d1440']);`,
    // Observed live: everything percent-encoded except "(" and ")" ("'" -> %27, "*" -> %2A).
    escape: { custom: (v) => encodeURIComponent(v).replace(/[!'*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) },
  },
};

export default fixture;
