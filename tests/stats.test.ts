import { describe, it, expect } from "vitest";
import { analyzeVotes } from "@/core/stats";

describe("analyzeVotes", () => {
  it("handles an empty vote set", () => {
    const s = analyzeVotes([], "unanimous");
    expect(s.count).toBe(0);
    expect(s.agreed).toBe(false);
    expect(s.agreedEstimate).toBeNull();
    expect(s.min).toBeNull();
    expect(s.mean).toBeNull();
  });

  it("computes basic statistics over numeric votes only", () => {
    const s = analyzeVotes([3, 5, 8, "?", "coffee"], "unanimous");
    expect(s.count).toBe(5);
    expect(s.numericCount).toBe(3);
    expect(s.questionCount).toBe(1);
    expect(s.coffeeCount).toBe(1);
    expect(s.min).toBe(3);
    expect(s.max).toBe(8);
    expect(s.mean).toBeCloseTo(16 / 3, 10);
    expect(s.median).toBe(5);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(((3 - 16 / 3) ** 2 + (5 - 16 / 3) ** 2 + (8 - 16 / 3) ** 2) / 3), 10);
  });

  it("median of an even count is the mean of the middle pair", () => {
    expect(analyzeVotes([2, 3, 5, 8], "unanimous").median).toBe(4);
  });

  it("spread is measured in steps on the card scale, not in points", () => {
    expect(analyzeVotes([5, 5], "unanimous").spreadSteps).toBe(0);
    expect(analyzeVotes([5, 8], "unanimous").spreadSteps).toBe(1);
    expect(analyzeVotes([1, 13], "unanimous").spreadSteps).toBe(5);
    expect(analyzeVotes([55, 100], "unanimous").spreadSteps).toBe(2);
  });

  it("finds the mode card and its share of all votes", () => {
    const s = analyzeVotes([5, 5, 5, 8], "unanimous");
    expect(s.modeCard).toBe(5);
    expect(s.modeShare).toBe(0.75);
  });

  it("mode ties resolve to the higher (more conservative) card", () => {
    expect(analyzeVotes([3, 3, 5, 5], "unanimous").modeCard).toBe(5);
  });

  it("unanimous rule: agreement only when all votes are the same number", () => {
    expect(analyzeVotes([5, 5, 5], "unanimous")).toMatchObject({ agreed: true, agreedEstimate: 5 });
    expect(analyzeVotes([5, 5, 8], "unanimous")).toMatchObject({ agreed: false, agreedEstimate: null });
  });

  it("adjacent rule: agreement within one card step, estimate is the higher card", () => {
    expect(analyzeVotes([5, 8, 8], "adjacent")).toMatchObject({ agreed: true, agreedEstimate: 8 });
    expect(analyzeVotes([3, 8], "adjacent")).toMatchObject({ agreed: false });
  });

  it("a ? or coffee vote blocks agreement", () => {
    expect(analyzeVotes([5, 5, "?"], "unanimous").agreed).toBe(false);
    expect(analyzeVotes([5, 5, "coffee"], "adjacent").agreed).toBe(false);
  });

  it("a single voter trivially agrees with themselves", () => {
    expect(analyzeVotes([13], "unanimous")).toMatchObject({ agreed: true, agreedEstimate: 13 });
  });

  it("only special cards -> no numeric stats, no agreement", () => {
    const s = analyzeVotes(["?", "coffee"], "unanimous");
    expect(s.numericCount).toBe(0);
    expect(s.min).toBeNull();
    expect(s.spreadSteps).toBeNull();
    expect(s.agreed).toBe(false);
  });
});
