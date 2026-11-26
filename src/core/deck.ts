/**
 * The estimation deck.
 *
 * Numeric cards follow the Fibonacci sequence from 0 up to 89, capped with 100
 * (the conventional "this is huge" card, used in place of 144). Two special
 * cards complete the deck:
 *   - `?`      "I cannot estimate this" (needs clarification). Blocks consensus.
 *   - `coffee` "I need a break". Counts as a vote (so the round can be revealed)
 *              but never as an estimate, and blocks consensus.
 */
export const NUMERIC_SCALE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100] as const;
export const UNSURE = '?' as const;
export const COFFEE = 'coffee' as const;

export type NumericCard = (typeof NUMERIC_SCALE)[number];
export type SpecialCard = typeof UNSURE | typeof COFFEE;
export type Card = NumericCard | SpecialCard;

export const DECK: readonly Card[] = [...NUMERIC_SCALE, UNSURE, COFFEE];

export function isNumericCard(v: unknown): v is NumericCard {
  return typeof v === 'number' && (NUMERIC_SCALE as readonly number[]).includes(v);
}

export function isCard(v: unknown): v is Card {
  return isNumericCard(v) || v === UNSURE || v === COFFEE;
}

/** Position of a numeric card on the scale (0 for card 0 ... 11 for card 100). */
export function cardIndex(card: number): number {
  return (NUMERIC_SCALE as readonly number[]).indexOf(card);
}

/** Snap any number to the nearest numeric card. Ties round up (conservative). */
export function nearestCard(value: number): NumericCard {
  let best: NumericCard = NUMERIC_SCALE[0];
  let bestDist = Infinity;
  for (const c of NUMERIC_SCALE) {
    const d = Math.abs(c - value);
    if (d < bestDist || (d === bestDist && c > best)) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
