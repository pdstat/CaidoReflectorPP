import { hostKey } from "../src/net/hostKey.js";

describe("hostKey", () => {
  test.each([
    ["api.example.com", "example.com"],
    ["WWW.Example.COM", "example.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["example.com", "example.com"],
    ["127.0.0.5", "127.0.0.5"],
    ["localhost", "localhost"],
    ["intranet", "intranet"],
    ["", ""],
  ])("%p -> %p", (host, expected) => {
    expect(hostKey(host)).toBe(expected);
  });
});
