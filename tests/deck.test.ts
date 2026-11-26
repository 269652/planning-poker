import { describe, it, expect } from "vitest";
import { DECK, NUMERIC_CARDS, isCard, isNumericCard, cardIndex } from "@/core/deck";

describe("deck", () => {
  it("has fibonacci cards from 0 up to 100 plus ? and coffee", () => {
    expect(DECK).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100, "?", "coffee"]);
  });

  it("NUMERIC_CARDS excludes the special cards", () => {
    expect(NUMERIC_CARDS).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100]);
  });

  it("isCard accepts only deck members", () => {
    expect(isCard(8)).toBe(true);
    expect(isCard("?")).toBe(true);
    expect(isCard("coffee")).toBe(true);
    expect(isCard(4)).toBe(false);
    expect(isCard("8")).toBe(false);
    expect(isCard(null)).toBe(false);
    expect(isCard(101)).toBe(false);
  });

  it("isNumericCard distinguishes numbers from special cards", () => {
    expect(isNumericCard(0)).toBe(true);
    expect(isNumericCard("?")).toBe(false);
    expect(isNumericCard("coffee")).toBe(false);
  });

  it("cardIndex gives the position on the numeric scale", () => {
    expect(cardIndex(0)).toBe(0);
    expect(cardIndex(5)).toBe(4);
    expect(cardIndex(100)).toBe(11);
    expect(() => cardIndex("?")).toThrow();
  });
});
