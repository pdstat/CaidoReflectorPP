import { runFixture, buildReplaySdk, type ReplayFixture } from "./replayHarness.ts";
import exampleFixture from "./example.fixture.ts";

describe("replay harness", () => {
  test("reproduces a confirmed JS-string breakout through the real detection code", async () => {
    const { body } = await runFixture(exampleFixture);
    const f = body.find((p) => p.name === "u");
    expect(f).toBeDefined();
    expect(f!.confirmed).toBe(true);
    expect(/script/i.test(f!.context)).toBe(true);
    expect(f!.severity).toBe("critical");
    expect(f!.aggressive).toContain('"');
  });

  test("an all-escaped server yields no confirmed finding (regression-safe baseline)", async () => {
    const safe: ReplayFixture = {
      name: "example-js-string-escaped",
      request: { query: "u=refval123", host: "example.com", path: "/cfg" },
      baseline: {
        code: 200,
        headers: { "Content-Type": "text/html" },
        body: `<script>var cfg = {"u":"refval123"};</script>`,
      },
      reflection: {
        source: "URL",
        param: "u",
        bodyTemplate: `<script>var cfg = {"u":"__REFLECT__"};</script>`,
        // Server backslash-escapes the quote and drops tag-escape chars -> no breakout.
        escape: { default: "raw", map: { '"': "backslash", "<": "drop", "/": "drop" } },
      },
    };
    const { body } = await runFixture(safe);
    const f = body.find((p) => p.name === "u");
    // Either suppressed entirely, or present only as unconfirmed/info -- never a confirmed hit.
    expect(f?.confirmed ?? false).toBe(false);
  });

  test("the replay prober models the server transformation (escape map applied)", async () => {
    const sdk = buildReplaySdk(exampleFixture);
    const spec = {
      getQuery: () => "u=" + encodeURIComponent('A"B<C'),
      getBody: () => undefined,
    };
    const resp = await sdk.requests.send(spec);
    // raw escape -> the quote and tag chars survive verbatim in the reflected position.
    expect(resp.response.getBody().toText()).toContain('{"u":"A"B<C"}');
  });
});
