import { detectEncodedOnly } from "../src/analysis/bodyReflection/encodedSignalDetection.js";
import { getEncodedSignals } from "../src/analysis/encodedSignalsStore.js";

const sdk = { console: { log: (_: string): void => {} } };

// Runs detection for one param and returns its recorded JSON-escaped hit count (0 if none).
function jsonEscapedCount(value: string, body: string): number {
  const input = {};
  detectEncodedOnly(sdk, input, "p", "URL", value, body);
  const signal = getEncodedSignals(input)?.find((s) => s.contexts.includes("jsonEscaped"));
  return signal?.count ?? 0;
}

const jsonBlock = (json: string): string => `<script type="application/json">${json}</script>`;
const uEscape = (s: string, upper = false): string =>
  [...s].map((c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(4, "0");
    return "\\u" + (upper ? hex.toUpperCase() : hex);
  }).join("");

describe("detectEncodedOnly: JSON \\uXXXX echoes", () => {
  test("a fully \\u-escaped value is one echo", () => {
    expect(jsonEscapedCount("rfxval", jsonBlock(`{"v":"${uEscape("rfxval")}"}`))).toBe(1);
  });

  test("upper-case hex escapes are recognised", () => {
    expect(jsonEscapedCount("rfxval", jsonBlock(`{"v":"${uEscape("rfxval", true)}"}`))).toBe(1);
  });

  test("a partially escaped value (only special chars escaped) is an echo", () => {
    expect(jsonEscapedCount("a<b>c", jsonBlock(`{"v":"a\\u003cb\\u003ec"}`))).toBe(1);
  });

  test("each echo is counted, across JSON blocks", () => {
    const esc = uEscape("rfxval");
    expect(jsonEscapedCount("rfxval", jsonBlock(`["${esc}","${esc}"]`) + jsonBlock(`"${esc}"`))).toBe(3);
  });

  test("a value that merely shares letters with escaped JSON is not an echo", () => {
    const body = jsonBlock(`{"v":"${uEscape("rfxb3newval")}"}`);
    expect(jsonEscapedCount("encoded-json-unicode", body)).toBe(0);
    expect(jsonEscapedCount("curl/8.14.1", body)).toBe(0);
  });

  test("an escaped backslash before u is literal text, not an escape", () => {
    expect(jsonEscapedCount("A", jsonBlock(`{"v":"\\\\u0041"}`))).toBe(0);
  });

  test("a literal (unescaped) value in a JSON block is not a \\u-escaped echo", () => {
    expect(jsonEscapedCount("rfxval", jsonBlock(`{"v":"rfxval"}`))).toBe(0);
  });

  test("escapes outside application/json script blocks are ignored", () => {
    expect(jsonEscapedCount("rfxval", `<script>var v = "${uEscape("rfxval")}";</script>`)).toBe(0);
  });
});
