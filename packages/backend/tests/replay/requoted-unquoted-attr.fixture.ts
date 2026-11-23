import type { ReplayFixture } from "./replayHarness.ts";

// Synthetic case modelling the FP class fixed in this iteration: a minifier emits the
// attribute unquoted (`value=orch`), replaces " ' < > with spaces, and re-quotes the value
// as soon as it contains whitespace. A probed space therefore "survives" but always lands
// inside a quoted value -- no attribute breakout.
const requote = (v: string): string => {
  const cleaned = v.replace(/["'<>]/g, " ");
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
};

const fixture: ReplayFixture = {
  name: "unquoted-attr-requoted-on-space",
  request: { query: "appName=orch", host: "shop.example.com", path: "/challenge" },
  baseline: {
    code: 200,
    headers: { "Content-Type": "text/html" },
    body: `<html><body><input type=hidden id=_appName value=orch><form id=f method=GET action=/x></form></body></html>`,
  },
  reflection: {
    source: "URL",
    param: "appName",
    bodyTemplate:
      `<html><body><input type=hidden id=_appName value=__REFLECT__><form id=f method=GET action=/x></form></body></html>`,
    escape: { default: "raw", custom: requote },
  },
};

export default fixture;
