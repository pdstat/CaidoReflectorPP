import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a standalone JS response
// echoes a version param into its trailing `//# sourceMappingURL=` line comment. The server
// lowercases and keeps only [a-z0-9/], so no line terminator can end the comment; the "/"
// that survives is inert. The quote-only scanner used to treat the comment as code ("Script").
const fixture: ReplayFixture = {
  name: "js-response-sourcemap-comment",
  request: { query: "m=core&v=081dff111a20aae8", host: "cdn.example.com", path: "/fp/app.js" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/javascript" },
    body: `(function(){var a=1;})();//# sourceMappingURL=https://cdn.example.com/fp/sym.map?module=core&version=081dff111a20aae8&variant=d73a\n//4c7bffae0643`,
  },
  reflection: {
    source: "URL",
    param: "v",
    bodyTemplate: `(function(){var a=1;})();//# sourceMappingURL=https://cdn.example.com/fp/sym.map?module=core&version=__REFLECT__&variant=d73a\n//4c7bffae0643`,
    escape: { custom: (v) => v.toLowerCase().replace(/[^a-z0-9/]/g, "") },
  },
};

export default fixture;
