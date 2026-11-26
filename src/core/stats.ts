import { type Card, type NumericCard, cardIndex, isNumericCard, NUMERIC_CARDS } from "./deck";

/**
 * unanimous: every vote must be the same numeric card.
 * adjacent:  all votes must lie within one card step (e.g. 5 and 8); the higher card wins.
 */
export type AgreementRule = "unanimous" | "adjacent";

export interface VoteStats {
  /** All votes cast, including special cards. */
  count: number;
  numericCount: number;
  questionCount: number;
  coffeeCount: number;
  min: NumericCard | null;
  max: NumericCard | null;
  mean: number | null;
  median: number | null;
  /** Population standard deviation of numeric votes, in story points. */
  stdDev: number | null;
  /** Distance between lowest and highest numeric vote, in card steps (scale-aware). */
  spreadSteps: number | null;
  modeCard: NumericCard | null;
  /** Share of ALL votes that sit on the mode card (0..1). */
  modeShare: number;
  agreed: boolean;
  agreedEstimate: NumericCard | null;
}

const TOLERANCE: Record<AgreementRule, number> = { unanimous: 0, adjacent: 1 };

export function analyzeVotes(votes: readonly Card[], rule: AgreementRule): VoteStats {
  const numeric: NumericCard[] = votes.filter(isNumericCard).sort((a, b) => a - b);
  const nums: number[] = numeric;
  const questionCount = votes.filter((v) => v === "?").length;
  const coffeeCount = votes.filter((v) => v === "coffee").length;

  const base = {
    count: votes.length,
    numericCount: numeric.length,
    questionCount,
    coffeeCount,
  };

  if (numeric.length === 0) {
    return {
      ...base,
      min: null, max: null, mean: null, median: null, stdDev: null,
      spreadSteps: null, modeCard: null, modeShare: 0,
      agreed: false, agreedEstimate: null,
    };
  }

  const min = numeric[0];
  const max = numeric[numeric.length - 1];
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(numeric.length / 2);
  const median = numeric.length % 2 ? numeric[mid] : (numeric[mid - 1] + numeric[mid]) / 2;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const spreadSteps = cardIndex(max) - cardIndex(min);

  // Mode: highest count, ties -> higher card (iterate ascending, >= wins).
  let modeCard: NumericCard = min;
  let modeCount = 0;
  for (const card of NUMERIC_CARDS) {
    const n = numeric.filter((v) => v === card).length;
    if (n > 0 && n >= modeCount) { modeCard = card; modeCount = n; }
  }

  const agreed = questionCount === 0 && coffeeCount === 0 && spreadSteps <= TOLERANCE[rule];

  return {
    ...base,
    min, max, mean, median,
    stdDev: Math.sqrt(variance),
    spreadSteps,
    modeCard,
    modeShare: modeCount / votes.length,
    agreed,
    agreedEstimate: agreed ? max : null,
  };
}
