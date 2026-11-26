import { Card, NUMERIC_SCALE, cardIndex, isNumericCard, nearestCard, COFFEE, UNSURE } from './deck';

/** Statistics describing one revealed round. All fields are plain JSON. */
export interface RoundStats {
  /** Eligible voters at reveal time (connected voters + anyone who voted). */
  voters: number;
  /** How many of them cast a card (any card, including ? and coffee). */
  voted: number;
  /** Count per card, keyed by the card's string form. */
  distribution: Record<string, number>;
  min: number | null;
  max: number | null;
  /** Median of numeric votes. Not snapped, so it can fall between cards. */
  median: number | null;
  mean: number | null;
  /** Most frequent numeric card (ties resolve to the higher card). */
  modal: number | null;
  /** modal votes / eligible voters, in [0, 1]. */
  modalShare: number;
  /** Distance between highest and lowest numeric vote, in deck steps. */
  spreadSteps: number | null;
  unsureCount: number;
  coffeeCount: number;
  /** Everyone eligible voted, every vote numeric, all identical. */
  consensus: boolean;
  consensusValue: number | null;
  /** Median snapped to the nearest card: a sensible suggestion when forcing. */
  suggested: number | null;
  /**
   * Single 0..1 agreement score used for charting convergence:
   *   modalShare * (1 - spreadSteps / maxSpread)
   * It is exactly 1 on consensus and falls as votes spread or voters abstain.
   */
  agreement: number;
}

export function computeRoundStats(votes: Record<string, Card>, voterCount: number): RoundStats {
  const cards = Object.values(votes);
  const voted = cards.length;
  const numeric: number[] = cards.filter(isNumericCard).sort((a, b) => a - b);

  const distribution: Record<string, number> = {};
  for (const c of cards) distribution[String(c)] = (distribution[String(c)] ?? 0) + 1;

  let modal: number | null = null;
  let modalCount = 0;
  for (const c of numeric) {
    const n = distribution[String(c)];
    if (n > modalCount || (n === modalCount && modal !== null && c > modal)) {
      modal = c;
      modalCount = n;
    }
  }

  const denominator = Math.max(voterCount, voted);
  const modalShare = denominator > 0 ? modalCount / denominator : 0;

  const min = numeric.length ? numeric[0] : null;
  const max = numeric.length ? numeric[numeric.length - 1] : null;
  const median = numeric.length ? medianOf(numeric) : null;
  const mean = numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  const spreadSteps = min !== null && max !== null ? cardIndex(max) - cardIndex(min) : null;

  const consensus =
    voterCount > 0 && voted >= voterCount && numeric.length === voted && numeric[0] === numeric[numeric.length - 1];

  const maxSpread = NUMERIC_SCALE.length - 1;
  const agreement = spreadSteps === null ? 0 : modalShare * (1 - spreadSteps / maxSpread);

  return {
    voters: voterCount,
    voted,
    distribution,
    min,
    max,
    median,
    mean,
    modal,
    modalShare,
    spreadSteps,
    unsureCount: distribution[UNSURE] ?? 0,
    coffeeCount: distribution[COFFEE] ?? 0,
    consensus,
    consensusValue: consensus ? numeric[0] : null,
    suggested: median === null ? null : nearestCard(median),
    agreement: consensus ? 1 : agreement,
  };
}

function medianOf(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
