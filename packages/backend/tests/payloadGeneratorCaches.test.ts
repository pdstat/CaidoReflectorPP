import ResponseBodyPayloadGenerator from "../src/payload/responseBodyPayloadGenerator.js";

// One generator instance answers many generate()/detect() calls; these pin the results the
// per-instance caches (element lists, attributes, JS quote state, tag spans) must preserve.

const sdk = { console: { log: (_: string): void => {} } };
const contexts = (html: string, value: string): string[] =>
  new ResponseBodyPayloadGenerator(html).generate(sdk, value).context;
const detected = (g: InstanceType<typeof ResponseBodyPayloadGenerator>, ctx: string[], pre: string, ch: string, suf: string): string[] =>
  g.detect(sdk, { context: ctx }, pre, ch, suf).map((r) => r.context);

describe("JS quote state", () => {
  test.each([
    ['<script>var a = "x\\"y VAL";</script>', "jsInDQuote"],
    ["<script>var a = 'it\\'s VAL';</script>", "jsInSQuote"],
    ['<script>var a = "x" + VAL;</script>', "js"],
    ["<script>var t = `a${b} VAL`;</script>", "jsTemplateLiteral"],
    ['<script>var a = "\\\\"; f(VAL);</script>', "js"],
  ])("%s -> %s", (html, expected) => {
    expect(contexts(html, "VAL")).toContain(expected);
  });

  test("every occurrence of a value in a large script is classified", () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) lines.push(`var s${i} = "q${i}"; call(\`t\${i}\`, 'x\\'y');`);
    lines.push(`var last = 'VAL';`);
    const html = `<script>${lines.join("\n")}</script>`;
    const ctx = contexts(html, "VAL");
    expect(ctx).toContain("jsInQuote");
    expect(ctx).toContain("jsInSQuote");
  });

  test("isQuoteInertInScript and isInScriptOutsideString agree across repeated calls", () => {
    const g = new ResponseBodyPayloadGenerator(`<script>var a = "BATCH x'y"; f(OUT);</script>`);
    // The ' sits in a "-string opened before the batch began: it cannot end that string.
    expect(g.isQuoteInertInScript("BATCH", "x", "'", "y")).toBe(true);
    expect(g.isInScriptOutsideString("OUT")).toBe(true);
    expect(g.isInScriptOutsideString("x'y")).toBe(false);
    expect(g.isInScriptOutsideString("OUT")).toBe(true);
  });

  test("a quote opened before the batch makes a different probed quote inert", () => {
    const g = new ResponseBodyPayloadGenerator(`<script>var a = "pre BATCHq1 P'S end";</script>`);
    expect(g.isQuoteInertInScript("BATCH", "P", "'", "S")).toBe(true);
  });
});

describe("one instance, many calls", () => {
  test("generate() gives the same contexts for different values on one instance", () => {
    const html = `<div title="ONE">TWO</div><script>x = 'ONE';</script>`;
    const g = new ResponseBodyPayloadGenerator(html);
    const one = g.generate(sdk, "ONE").context;
    const two = g.generate(sdk, "TWO").context;
    expect(one).toEqual(contexts(html, "ONE"));
    expect(two).toEqual(contexts(html, "TWO"));
    expect(g.generate(sdk, "ONE").context).toEqual(one);
  });

  test("detect() answers each marker independently on one instance", () => {
    const g = new ResponseBodyPayloadGenerator(`<input value="AA"BB"><p>CC<DD</p>`);
    expect(detected(g, ["attributeInQuote"], "AA", '"', "BB")).toContain("attributeInQuote");
    expect(detected(g, ["html"], "CC", "<", "DD")).toContain("html");
    expect(detected(g, ["attributeInQuote"], "ZZ", '"', "YY")).toEqual([]);
  });
});

describe("raw start-tag fallbacks", () => {
  // The marker sits in a start tag but not in any parsed attribute value.
  test("a marker inside a start tag's text is found", () => {
    const g = new ResponseBodyPayloadGenerator(`<div class="a" PRE;SUF data-x="1">t</div>`);
    expect(detected(g, ["attribute"], "PRE", ";", "SUF")).toContain("attribute");
  });

  test("a marker just after the tag's '>' is not", () => {
    const g = new ResponseBodyPayloadGenerator(`<div class="a">PRE=SUF</div>`);
    expect(detected(g, ["urlAttr"], "PRE", "=", "SUF")).toEqual([]);
  });

  test("a marker ending exactly at the tag's '>' is inside the tag", () => {
    expect(detected(new ResponseBodyPayloadGenerator(`<img src=x PR=>`), ["urlAttr"], "PR", "=", ">"))
      .toContain("urlAttr");
    expect(detected(new ResponseBodyPayloadGenerator(`<img src=x>PR=>`), ["urlAttr"], "PR", "=", ">"))
      .toEqual([]);
  });

  test("an on*= value region extends to the tag's '>'", () => {
    const g = new ResponseBodyPayloadGenerator(`<b onclick= go() PRE(SUF >x</b>`);
    expect(detected(g, ["eventHandlerAttr"], "PRE", "(", "SUF")).toContain("eventHandlerAttr");
  });
});
