/**
 * The planning deck: Fibonacci steps from 0 up to a capped 100, plus the two
 * special cards "?" (cannot estimate / need more info) and "coffee" (break).
 *
 * 100 is not a Fibonacci number (the next one after 89 is 144); it is kept as
 * the deliberate top-of-scale "epic, needs splitting" card so the deck spans the
 * requested 0..100 range.
 */
export type SpecialCard = "?" | "coffee";
export type NumericCard = 0 | 1 | 2 | 3 | 5 | 8 | 13 | 21 | 34 | 55 | 89 | 100;
export type Card = NumericCard | SpecialCard;

export const NUMERIC_CARDS: readonly NumericCard[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100];
export const DECK: readonly Card[] = [...NUMERIC_CARDS, "?", "coffee"];

export function isCard(x: unknown): x is Card {
  return (DECK as readonly unknown[]).includes(x);
}

export function isNumericCard(x: unknown): x is NumericCard {
  return typeof x === "number" && (NUMERIC_CARDS as readonly number[]).includes(x);
}

/** Position of a numeric card on the scale (0..11). Distances between indices are "steps". */
export function cardIndex(card: Card): number {
  if (!isNumericCard(card)) throw new Error(`Card ${String(card)} has no position on the numeric scale`);
  return NUMERIC_CARDS.indexOf(card);
}
