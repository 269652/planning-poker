import { describe, expect, it } from 'vitest';
import { COFFEE, DECK, NUMERIC_SCALE, UNSURE, cardIndex, isCard, isNumericCard, nearestCard } from '@/core/deck';

describe('deck', () => {
  it('contains fibonacci steps from 0 to 100 plus ? and coffee', () => {
    expect(NUMERIC_SCALE).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100]);
    expect(DECK).toEqual([...NUMERIC_SCALE, UNSURE, COFFEE]);
  });

  it('validates cards', () => {
    for (const c of DECK) expect(isCard(c)).toBe(true);
    for (const bad of [4, -1, 144, '5', 'x', null, undefined, 1.5, NaN, {}]) expect(isCard(bad)).toBe(false);
  });

  it('distinguishes numeric from special cards', () => {
    expect(isNumericCard(8)).toBe(true);
    expect(isNumericCard(0)).toBe(true);
    expect(isNumericCard(UNSURE)).toBe(false);
    expect(isNumericCard(COFFEE)).toBe(false);
  });

  it('indexes cards on the numeric scale', () => {
    expect(cardIndex(0)).toBe(0);
    expect(cardIndex(13)).toBe(6);
    expect(cardIndex(100)).toBe(11);
  });

  it('snaps arbitrary values to the nearest card, ties rounding up', () => {
    expect(nearestCard(0)).toBe(0);
    expect(nearestCard(4)).toBe(5); // tie between 3 and 5 -> up
    expect(nearestCard(6)).toBe(5);
    expect(nearestCard(7)).toBe(8);
    expect(nearestCard(60)).toBe(55);
    expect(nearestCard(500)).toBe(100);
    expect(nearestCard(-3)).toBe(0);
  });
});
