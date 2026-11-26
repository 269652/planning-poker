import { describe, expect, it } from 'vitest';
import { computeRoundStats } from '@/core/stats';

describe('computeRoundStats', () => {
  it('detects consensus when every eligible voter picked the same number', () => {
    const s = computeRoundStats({ a: 5, b: 5, c: 5 }, 3);
    expect(s.consensus).toBe(true);
    expect(s.consensusValue).toBe(5);
    expect(s.spreadSteps).toBe(0);
    expect(s.modalShare).toBe(1);
    expect(s.agreement).toBe(1);
    expect(s.suggested).toBe(5);
  });

  it('is not consensus when someone has not voted', () => {
    const s = computeRoundStats({ a: 5, b: 5 }, 3);
    expect(s.consensus).toBe(false);
    expect(s.voted).toBe(2);
    expect(s.voters).toBe(3);
    expect(s.consensusValue).toBeNull();
  });

  it('computes min/max/median/mean/spread over numeric votes only', () => {
    const s = computeRoundStats({ a: 2, b: 5, c: 13, d: '?', e: 'coffee' }, 5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(13);
    expect(s.median).toBe(5);
    expect(s.mean).toBeCloseTo(20 / 3);
    expect(s.spreadSteps).toBe(4); // idx 2 (2) -> idx 6 (13)
    expect(s.unsureCount).toBe(1);
    expect(s.coffeeCount).toBe(1);
    expect(s.consensus).toBe(false);
    expect(s.suggested).toBe(5);
  });

  it('? and coffee block consensus even if all numeric votes match', () => {
    expect(computeRoundStats({ a: 3, b: 3, c: '?' }, 3).consensus).toBe(false);
    expect(computeRoundStats({ a: 3, b: 3, c: 'coffee' }, 3).consensus).toBe(false);
  });

  it('reports distribution keyed by card', () => {
    const s = computeRoundStats({ a: 3, b: 3, c: 8, d: '?' }, 4);
    expect(s.distribution).toEqual({ '3': 2, '8': 1, '?': 1 });
    expect(s.modal).toBe(3);
    expect(s.modalShare).toBeCloseTo(0.5); // 2 of 4 voters
  });

  it('median of an even count snaps to a card (ties up)', () => {
    const s = computeRoundStats({ a: 3, b: 5 }, 2);
    expect(s.median).toBe(4);
    expect(s.suggested).toBe(5);
  });

  it('handles rounds without numeric votes', () => {
    const s = computeRoundStats({ a: '?', b: 'coffee' }, 2);
    expect(s.min).toBeNull();
    expect(s.median).toBeNull();
    expect(s.spreadSteps).toBeNull();
    expect(s.suggested).toBeNull();
    expect(s.agreement).toBe(0);
  });

  it('agreement shrinks as spread widens', () => {
    const tight = computeRoundStats({ a: 5, b: 5, c: 8 }, 3).agreement;
    const wide = computeRoundStats({ a: 1, b: 5, c: 55 }, 3).agreement;
    expect(tight).toBeGreaterThan(wide);
    expect(tight).toBeLessThan(1);
    expect(wide).toBeGreaterThanOrEqual(0);
  });

  it('empty round is safe', () => {
    const s = computeRoundStats({}, 0);
    expect(s.consensus).toBe(false);
    expect(s.voted).toBe(0);
  });
});
