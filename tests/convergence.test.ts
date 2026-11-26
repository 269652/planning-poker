import { describe, it, expect } from "vitest";
import { analyzeVotes } from "@/core/stats";
import { convergenceScore, analyzeConvergence } from "@/core/convergence";

const stats = (votes: Parameters<typeof analyzeVotes>[0]) => analyzeVotes(votes, "unanimous");

describe("convergenceScore", () => {
  it("is 1 for unanimous numeric votes", () => {
    expect(convergenceScore(stats([5, 5, 5]))).toBe(1);
  });

  it("is 0 for no votes or no numeric votes", () => {
    expect(convergenceScore(stats([]))).toBe(0);
    expect(convergenceScore(stats(["?", "?"]))).toBe(0);
  });

  it("decreases as the spread widens", () => {
    const tight = convergenceScore(stats([5, 5, 8]));
    const wide = convergenceScore(stats([1, 5, 21]));
    expect(tight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThan(0);
    expect(tight).toBeLessThan(1);
  });

  it("is always within [0,1]", () => {
    for (const v of [[0, 100], [0, 0, 100], [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100]] as const) {
      const c = convergenceScore(stats([...v]));
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("analyzeConvergence", () => {
  it("reports 'none' trend with no rounds", () => {
    expect(analyzeConvergence([])).toMatchObject({ trend: "none", scores: [], spreads: [] });
  });

  it("reports 'first' for a single round", () => {
    const c = analyzeConvergence([stats([3, 13])]);
    expect(c.trend).toBe("first");
    expect(c.scores).toHaveLength(1);
  });

  it("detects converging rounds (spread shrinks)", () => {
    const c = analyzeConvergence([stats([1, 5, 21]), stats([3, 5, 8])]);
    expect(c.trend).toBe("converging");
    expect(c.spreads).toEqual([6, 2]);
    expect(c.delta).toBeGreaterThan(0);
  });

  it("detects diverging rounds (spread grows)", () => {
    expect(analyzeConvergence([stats([5, 8]), stats([2, 13])]).trend).toBe("diverging");
  });

  it("detects stalled rounds (same score)", () => {
    expect(analyzeConvergence([stats([5, 13]), stats([3, 8])]).trend).toBe("stalled");
  });

  it("reports 'agreed' when the latest round is unanimous-agreed", () => {
    expect(analyzeConvergence([stats([3, 13]), stats([8, 8])]).trend).toBe("agreed");
  });

  it("counts rounds-to-agreement only when agreed", () => {
    expect(analyzeConvergence([stats([3, 13]), stats([8, 8])]).roundsToAgreement).toBe(2);
    expect(analyzeConvergence([stats([3, 13])]).roundsToAgreement).toBeNull();
  });
});
