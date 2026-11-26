import { describe, expect, it } from 'vitest';
import { analyzeConvergence } from '@/core/convergence';
import { computeRoundStats } from '@/core/stats';

const r = (n: number, votes: Record<string, any>, voters = Object.keys(votes).length) => ({
  number: n,
  stats: computeRoundStats(votes, voters),
});

describe('analyzeConvergence', () => {
  it('has no trend with zero or one round', () => {
    expect(analyzeConvergence([]).trend).toBe('none');
    expect(analyzeConvergence([r(1, { a: 2, b: 8 })]).trend).toBe('first-round');
  });

  it('reports converging when spread narrows', () => {
    const c = analyzeConvergence([r(1, { a: 1, b: 5, c: 21 }), r(2, { a: 3, b: 5, c: 8 })]);
    expect(c.trend).toBe('converging');
    expect(c.rounds.map((x) => x.spreadSteps)).toEqual([6, 2]);
    expect(c.rounds[1].delta).toBeLessThan(0);
    expect(c.reached).toBe(false);
  });

  it('reports diverging when spread widens', () => {
    const c = analyzeConvergence([r(1, { a: 3, b: 5 }), r(2, { a: 1, b: 21 })]);
    expect(c.trend).toBe('diverging');
  });

  it('breaks equal-spread ties on modal share', () => {
    const c = analyzeConvergence([r(1, { a: 3, b: 5, c: 8, d: 8 }), r(2, { a: 3, b: 8, c: 8, d: 8 })]);
    expect(c.trend).toBe('converging'); // same spread (2), modal share 0.5 -> 0.75
    const s = analyzeConvergence([r(1, { a: 3, b: 8 }), r(2, { a: 3, b: 8 })]);
    expect(s.trend).toBe('steady');
  });

  it('reports agreed when the latest round is a consensus', () => {
    const c = analyzeConvergence([r(1, { a: 3, b: 13 }), r(2, { a: 5, b: 8 }), r(3, { a: 5, b: 5 })]);
    expect(c.trend).toBe('agreed');
    expect(c.reached).toBe(true);
    expect(c.roundsToAgreement).toBe(3);
  });

  it('exposes per-round agreement scores for charting', () => {
    const c = analyzeConvergence([r(1, { a: 1, b: 21 }), r(2, { a: 5, b: 5 })]);
    expect(c.rounds[0].agreement).toBeLessThan(c.rounds[1].agreement);
    expect(c.rounds[1].agreement).toBe(1);
  });
});
