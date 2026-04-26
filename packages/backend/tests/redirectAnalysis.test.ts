import {
  detectRedirectPosition,
  getSubdomainBreakoutChars,
  classifyRedirectSeverity
} from "../src/analysis/redirectAnalysis.js";

describe("detectRedirectPosition", () => {
  describe("full-url control", () => {
    test("entire header value is the param", () => {
      expect(detectRedirectPosition("test123", "test123", "Location"))
        .toBe("full-url");
    });

    test("param at start with path suffix", () => {
      expect(detectRedirectPosition("test123/page", "test123", "Location"))
        .toBe("full-url");
    });

    test("param at start with query suffix", () => {
      expect(detectRedirectPosition("test123?x=1", "test123", "Location"))
        .toBe("full-url");
    });

    test("empty header returns unknown", () => {
      expect(detectRedirectPosition("", "test", "Location"))
        .toBe("unknown");
    });
  });

  describe("scheme position", () => {
    test("param before ://", () => {
      expect(detectRedirectPosition("test123://target.com/path", "test123", "Location"))
        .toBe("scheme");
    });

    test("param before :// with no path", () => {
      expect(detectRedirectPosition("test123://target.com", "test123", "Location"))
        .toBe("scheme");
    });
  });

  describe("host position", () => {
    test("param after https:// with path suffix", () => {
      expect(detectRedirectPosition("https://test123/path", "test123", "Location"))
        .toBe("host");
    });

    test("param after https:// with no suffix", () => {
      expect(detectRedirectPosition("https://test123", "test123", "Location"))
        .toBe("host");
    });

    test("param after protocol-relative //", () => {
      expect(detectRedirectPosition("//test123/page", "test123", "Location"))
        .toBe("host");
    });

    test("param after userinfo@ (host after @)", () => {
      expect(detectRedirectPosition(
        "https://safe.example@test123/page", "test123", "Location"
      )).toBe("host");
    });

    test("param after user:pass@ (host after @)", () => {
      expect(detectRedirectPosition(
        "https://user:pass@test123/page", "test123", "Location"
      )).toBe("host");
    });

    test("param after http://", () => {
      expect(detectRedirectPosition("http://test123/", "test123", "Location"))
        .toBe("host");
    });
  });

  describe("subdomain position", () => {
    test("param after https:// with dot suffix", () => {
      expect(detectRedirectPosition(
        "https://test123.target.com/path", "test123", "Location"
      )).toBe("subdomain");
    });

    test("param after https:// with dot suffix and no path", () => {
      expect(detectRedirectPosition(
        "https://test123.target.com", "test123", "Location"
      )).toBe("subdomain");
    });

    test("param after existing subdomain label", () => {
      expect(detectRedirectPosition(
        "https://sub.test123.target.com/path", "test123", "Location"
      )).toBe("subdomain");
    });

    test("param after protocol-relative with dot suffix", () => {
      expect(detectRedirectPosition(
        "//test123.target.com/path", "test123", "Location"
      )).toBe("subdomain");
    });

    test("param after userinfo@ with dot suffix", () => {
      expect(detectRedirectPosition(
        "https://user@test123.target.com/path", "test123", "Location"
      )).toBe("subdomain");
    });
  });

  describe("path position", () => {
    test("param in path segment", () => {
      expect(detectRedirectPosition(
        "https://target.com/test123/page", "test123", "Location"
      )).toBe("path");
    });

    test("param as entire path", () => {
      expect(detectRedirectPosition(
        "https://target.com/test123", "test123", "Location"
      )).toBe("path");
    });

    test("param in relative path", () => {
      expect(detectRedirectPosition(
        "/redirect/test123/page", "test123", "Location"
      )).toBe("path");
    });

    test("param as relative path root", () => {
      expect(detectRedirectPosition("/test123", "test123", "Location"))
        .toBe("path");
    });
  });

  describe("query position", () => {
    test("param in query value", () => {
      expect(detectRedirectPosition(
        "https://target.com/page?next=test123", "test123", "Location"
      )).toBe("query");
    });

    test("param in query with multiple params", () => {
      expect(detectRedirectPosition(
        "https://target.com/page?a=1&next=test123&b=2", "test123", "Location"
      )).toBe("query");
    });

    test("param in relative URL query", () => {
      expect(detectRedirectPosition(
        "/page?redirect=test123", "test123", "Location"
      )).toBe("query");
    });

    test("bare query string", () => {
      expect(detectRedirectPosition("?q=test123", "test123", "Location"))
        .toBe("query");
    });
  });

  describe("fragment position", () => {
    test("param in fragment", () => {
      expect(detectRedirectPosition(
        "https://target.com/page#test123", "test123", "Location"
      )).toBe("fragment");
    });

    test("param in fragment after query", () => {
      expect(detectRedirectPosition(
        "https://target.com/page?q=1#test123", "test123", "Location"
      )).toBe("fragment");
    });

    test("param in relative URL fragment", () => {
      expect(detectRedirectPosition(
        "/page?q=1#test123", "test123", "Location"
      )).toBe("fragment");
    });
  });

  describe("Refresh header", () => {
    test("extracts URL after N; url= prefix", () => {
      expect(detectRedirectPosition(
        "5; url=https://test123/path", "test123", "Refresh"
      )).toBe("host");
    });

    test("extracts URL after 0;url= (no space)", () => {
      expect(detectRedirectPosition(
        "0;url=https://target.com/test123", "test123", "Refresh"
      )).toBe("path");
    });

    test("full URL control in Refresh", () => {
      expect(detectRedirectPosition(
        "0; url=test123", "test123", "Refresh"
      )).toBe("full-url");
    });

    test("subdomain in Refresh", () => {
      expect(detectRedirectPosition(
        "5; URL=https://test123.target.com/", "test123", "Refresh"
      )).toBe("subdomain");
    });
  });

  describe("edge cases", () => {
    test("empty param value returns unknown", () => {
      expect(detectRedirectPosition("https://target.com", "", "Location"))
        .toBe("unknown");
    });

    test("param not found returns unknown", () => {
      expect(detectRedirectPosition(
        "https://target.com/page", "nothere", "Location"
      )).toBe("unknown");
    });

    test("case-insensitive matching", () => {
      expect(detectRedirectPosition(
        "https://TEST123.target.com/", "test123", "Location"
      )).toBe("subdomain");
    });

    test("port position returns unknown", () => {
      expect(detectRedirectPosition(
        "https://target.com:test123/path", "test123", "Location"
      )).toBe("unknown");
    });
  });
});

describe("getSubdomainBreakoutChars", () => {
  test("identifies ? as breakout", () => {
    expect(getSubdomainBreakoutChars(['?', 'a', 'b']))
      .toEqual(['?']);
  });

  test("identifies / as breakout", () => {
    expect(getSubdomainBreakoutChars(['/', '=']))
      .toEqual(['/']);
  });

  test("identifies # as breakout", () => {
    expect(getSubdomainBreakoutChars(['#']))
      .toEqual(['#']);
  });

  test("identifies \\ as breakout", () => {
    expect(getSubdomainBreakoutChars(['\\']))
      .toEqual(['\\']);
  });

  test("identifies multiple breakout chars", () => {
    expect(getSubdomainBreakoutChars(['?', '/', '#', '\\', ':', '=']))
      .toEqual(['?', '/', '#', '\\']);
  });

  test("returns empty for non-breakout chars", () => {
    expect(getSubdomainBreakoutChars([':', '=', '&', '<']))
      .toEqual([]);
  });

  test("returns empty for empty input", () => {
    expect(getSubdomainBreakoutChars([]))
      .toEqual([]);
  });
});

describe("classifyRedirectSeverity", () => {
  test("full-url is high", () => {
    expect(classifyRedirectSeverity('full-url', [])).toBe('high');
  });

  test("host is high", () => {
    expect(classifyRedirectSeverity('host', [])).toBe('high');
  });

  test("scheme is high", () => {
    expect(classifyRedirectSeverity('scheme', [])).toBe('high');
  });

  test("subdomain without breakout is medium", () => {
    expect(classifyRedirectSeverity('subdomain', [':'])).toBe('medium');
  });

  test("subdomain with ? breakout is high", () => {
    expect(classifyRedirectSeverity('subdomain', ['?'])).toBe('high');
  });

  test("subdomain with / breakout is high", () => {
    expect(classifyRedirectSeverity('subdomain', ['/', ':'])).toBe('high');
  });

  test("subdomain with # breakout is high", () => {
    expect(classifyRedirectSeverity('subdomain', ['#'])).toBe('high');
  });

  test("subdomain with \\ breakout is high", () => {
    expect(classifyRedirectSeverity('subdomain', ['\\'])).toBe('high');
  });

  test("path is medium", () => {
    expect(classifyRedirectSeverity('path', ['/', '?'])).toBe('medium');
  });

  test("query is low", () => {
    expect(classifyRedirectSeverity('query', ['&', '='])).toBe('low');
  });

  test("fragment is low", () => {
    expect(classifyRedirectSeverity('fragment', [])).toBe('low');
  });

  test("unknown with / falls back to high", () => {
    expect(classifyRedirectSeverity('unknown', ['/'])).toBe('high');
  });

  test("unknown with : falls back to high", () => {
    expect(classifyRedirectSeverity('unknown', [':'])).toBe('high');
  });

  test("unknown without redirect chars is medium", () => {
    expect(classifyRedirectSeverity('unknown', ['='])).toBe('medium');
  });

  test("undefined position with / falls back to high", () => {
    expect(classifyRedirectSeverity(undefined, ['/'])).toBe('high');
  });

  test("undefined position without redirect chars is medium", () => {
    expect(classifyRedirectSeverity(undefined, ['='])).toBe('medium');
  });
});
