import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration (a search-results page):
// the short baseline value "play" collides with an unrelated single-quoted string
// ('display:none'), so the reflection is labelled Script String ('). The real reflection is
// URL-encoded inside a DOUBLE-quoted string; encodeURIComponent leaves "'" raw there, where it
// is inert. The "'" probe used to count as a breakout of the (') label -> critical.
const fixture: ReplayFixture = {
  name: "foreign-quote-collision",
  request: { query: "q=playstation&oq=play", host: "search.example.com", path: "/search" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><script>var a='display:none';var h="<a href=\\"/search?q=playstation&oq=play\\">x</a>";</script></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "oq",
    bodyTemplate: `<html><body><script>var a='display:none';var h="<a href=\\"/search?q=playstation&oq=__REFLECT__\\">x</a>";</script></body></html>`,
    escape: { custom: (v) => encodeURIComponent(v) },
  },
};

export default fixture;
