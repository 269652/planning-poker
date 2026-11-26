import type { RoundStats } from './stats';

export type Trend =
  | 'none' // no revealed rounds yet
  | 'first-round' // only one round: nothing to compare
  | 'converging' // votes are getting closer
  | 'diverging' // votes are moving apart
  | 'steady' // no measurable change
  | 'agreed'; // latest round is a consensus

export interface ConvergenceRound {
  number: number;
  spreadSteps: number | null;
  modalShare: number;
  agreement: number;
  /** Change in spread (in deck steps) versus the previous round; negative is better. */
  delta: number | null;
}

export interface Convergence {
  trend: Trend;
  rounds: ConvergenceRound[];
  reached: boolean;
  roundsToAgreement: number | null;
}

/**
 * Describe how a ticket's rounds are progressing towards agreement.
 * Only revealed rounds (those that have stats) take part.
 *
 * Trend compares the last two rounds: a smaller spread is better; equal spread
 * is broken by the share of voters on the most popular card.
 */
export function analyzeConvergence(rounds: { number: number; stats: RoundStats }[]): Convergence {
  const out: ConvergenceRound[] = rounds.map((r, i) => {
    const prev = i > 0 ? rounds[i - 1].stats : null;
    const delta =
      prev && prev.spreadSteps !== null && r.stats.spreadSteps !== null ? r.stats.spreadSteps - prev.spreadSteps : null;
    return {
      number: r.number,
      spreadSteps: r.stats.spreadSteps,
      modalShare: r.stats.modalShare,
      agreement: r.stats.agreement,
      delta,
    };
  });

  if (rounds.length === 0) return { trend: 'none', rounds: out, reached: false, roundsToAgreement: null };

  const last = rounds[rounds.length - 1];
  if (last.stats.consensus) {
    return { trend: 'agreed', rounds: out, reached: true, roundsToAgreement: last.number };
  }
  if (rounds.length === 1) return { trend: 'first-round', rounds: out, reached: false, roundsToAgreement: null };

  const prev = rounds[rounds.length - 2].stats;
  return { trend: compare(prev, last.stats), rounds: out, reached: false, roundsToAgreement: null };
}

function compare(prev: RoundStats, cur: RoundStats): Trend {
  if (prev.spreadSteps === null || cur.spreadSteps === null) return 'steady';
  if (cur.spreadSteps < prev.spreadSteps) return 'converging';
  if (cur.spreadSteps > prev.spreadSteps) return 'diverging';
  if (cur.modalShare > prev.modalShare) return 'converging';
  if (cur.modalShare < prev.modalShare) return 'diverging';
  return 'steady';
}
