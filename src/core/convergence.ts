import { NUMERIC_CARDS } from "./deck";
import type { VoteStats } from "./stats";

const MAX_SPREAD = NUMERIC_CARDS.length - 1;
const EPS = 1e-9;

/**
 * How close a single round is to consensus, in [0,1].
 *   score = modeShare * (1 - spreadSteps / maxSpread)
 * 1 means everybody voted the same numeric card. It rewards both a dominant
 * card (modeShare) and a narrow spread on the card scale, and is 0 when there
 * are no numeric votes at all.
 */
export function convergenceScore(s: VoteStats): number {
  if (s.numericCount === 0 || s.spreadSteps === null) return 0;
  return s.modeShare * (1 - s.spreadSteps / MAX_SPREAD);
}

export type Trend = "none" | "first" | "converging" | "diverging" | "stalled" | "agreed";

export interface Convergence {
  trend: Trend;
  /** Per round convergence score. */
  scores: number[];
  /** Per round spread in card steps (null when a round had no numeric votes). */
  spreads: (number | null)[];
  /** Score change between the last two rounds (positive = converging). */
  delta: number;
  /** 1-based round number in which agreement was reached, if the latest round agreed. */
  roundsToAgreement: number | null;
}

/** Progress across all revealed rounds of one ticket. */
export function analyzeConvergence(rounds: readonly VoteStats[]): Convergence {
  const scores = rounds.map(convergenceScore);
  const spreads = rounds.map((r) => r.spreadSteps);
  if (rounds.length === 0) return { trend: "none", scores, spreads, delta: 0, roundsToAgreement: null };

  const last = rounds[rounds.length - 1];
  const delta = rounds.length > 1 ? scores[scores.length - 1] - scores[scores.length - 2] : 0;
  const roundsToAgreement = last.agreed ? rounds.length : null;

  let trend: Trend;
  if (last.agreed) trend = "agreed";
  else if (rounds.length === 1) trend = "first";
  else if (delta > EPS) trend = "converging";
  else if (delta < -EPS) trend = "diverging";
  else trend = "stalled";

  return { trend, scores, spreads, delta, roundsToAgreement };
}
