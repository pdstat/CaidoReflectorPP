import { scoreFinding } from "../src/analysis/scoring.js";

// Helper to run and return tuple
function compute(inp: Parameters<typeof scoreFinding>[0]) {
  return scoreFinding(inp);
}

describe("scoreFinding", () => {
  test("confirmed Script context with powerful chars clamps severity to 100 and expected total", () => {
    const r = compute({
      confirmed: true,
      allowedChars: ['<', '"'],
      context: 'Script',
      header: false,
      matchCount: 1,
      stableProbe: false
    });
    expect(r.severity).toBe(100); // 80 base + 15 (charSet*0.6) + 12 (quote bonus) + 6 (< bonus) => 113 -> clamp
    expect(r.confidence).toBe(55); // 30 base + 25 confirmed
    expect(r.total).toBe(71); // derived from current formula
  });

  test("unconfirmed attributeEscaped heavily penalized", () => {
    const r = compute({
      confirmed: false,
      allowedChars: [],
      context: 'attributeEscaped',
      header: false,
      matchCount: 1,
      stableProbe: false
    });
    expect(r.confidence).toBe(18); // 30 -12 escaped penalty
    expect(r.severity).toBe(4);    // base 22 (down-ranked) -18 escaped penalty
    expect(r.total).toBe(10);      // formula output with current weighting
  });

  test("confirmed high-weight header (Location)", () => {
    const r = compute({
      confirmed: true,
      allowedChars: [],
      context: 'Response Header',
      header: true,
      headerNames: ['Location'],
      matchCount: 1,
      stableProbe: false
    });
    expect(r.severity).toBe(75); // headerWeight(location)=75
    expect(r.confidence).toBe(55); // confirmed
    expect(r.total).toBe(62);
  });

  test("multi-match unconfirmed generic header (unweighted name)", () => {
    const r = compute({
      confirmed: false,
      allowedChars: [],
      context: 'Response Header',
      header: true,
      headerNames: ['X-Custom-Thing'], // default weight 35 -> max(40, 35)=40
      matchCount: 3, // adds +6 confidence
      stableProbe: false
    });
    expect(r.severity).toBe(40);
    expect(r.confidence).toBe(36);
    expect(r.total).toBe(37);
  });

  test("stableProbe boosts confidence (html context minimal chars)", () => {
    const r = compute({
      confirmed: false,
      allowedChars: ['>'],
      context: 'html',
      header: false,
      matchCount: 1,
      stableProbe: true
    });
    expect(r.severity).toBe(38); // 35 base + (charSet 5 *0.6 =3)
    expect(r.confidence).toBe(40); // 30 + 10 stableProbe
    expect(r.total).toBe(39);
  });
});
