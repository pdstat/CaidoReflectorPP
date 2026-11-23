import { runFixture, buildReplaySdk, type ReplayFixture } from "./replayHarness.ts";
import exampleFixture from "./example.fixture.ts";
import jsonBodyFixture from "./json-body.fixture.ts";
import genericHeaderFixture from "./generic-header.fixture.ts";
import scriptCloseFixture from "./script-close-escape.fixture.ts";
import encodedTextFixture from "./encoded-text-raw-script.fixture.ts";
import nestedJsonFixture from "./nested-json-script.fixture.ts";

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

  test("confirms a JSON request-body param reflected into a JS string (FN class fixed)", async () => {
    const { body } = await runFixture(jsonBodyFixture);
    const f = body.find((p) => p.name === "body.imp[0].tagid");
    expect(f).toBeDefined();
    expect(f!.source).toBe("BodyJsonRaw");
    expect(f!.confirmed).toBe(true);
    expect(/script/i.test(f!.context)).toBe(true);
    expect(f!.aggressive).toContain("'");
  });

  test("a generic-header reflection scores low end-to-end even with surviving chars", async () => {
    const { header } = await runFixture(genericHeaderFixture);
    const f = header.find((p) => p.name === "cb");
    expect(f).toBeDefined();
    expect(f!.confirmed).toBe(true);
    expect(f!.severity).toBe("low");
  });

  test("an escaped </ sequence in a script string is not a script-tag breakout (FP class fixed)", async () => {
    const { body } = await runFixture(scriptCloseFixture);
    const f = body.find((p) => p.name === "_from");
    expect(f).toBeDefined();
    expect(f!.confirmed).toBe(true);
    expect(/script string/i.test(f!.context)).toBe(true);
    expect(f!.aggressive).not.toContain("<");
    expect(f!.severity).toBe("low");
  });

  test("entity-encoded HTML text does not escalate a sealed script string to HTML (FP class fixed)", async () => {
    const { body } = await runFixture(encodedTextFixture);
    const f = body.find((p) => p.name === "q");
    expect(f).toBeDefined();
    expect(f!.confirmed).toBe(true);
    expect(/script string/i.test(f!.context)).toBe(true);
    expect(f!.severity).toBe("low");
  });

  test("a correctly escaped nested JSON-in-JS string is not a backslash escape (FP class fixed)", async () => {
    const { body } = await runFixture(nestedJsonFixture);
    const f = body.find((p) => p.name === "referrer");
    expect(f).toBeDefined();
    expect(f!.confirmed).toBe(true);
    expect(/script string/i.test(f!.context)).toBe(true);
    expect(f!.aggressive).not.toContain("\\");
    expect(f!.severity).toBe("low");
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
