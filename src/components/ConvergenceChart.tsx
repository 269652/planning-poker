import { NUMERIC_CARDS, type NumericCard } from "@/core/deck";
import type { Convergence } from "@/core/convergence";
import type { RoundView } from "@/core/room";

const COL = 64, TOP = 14, ROW = 15, LEFT = 34;

/** Strip plot: one column per revealed round, dots at the cards that were voted, range bar min..max. */
export default function ConvergenceChart({ rounds, convergence }: { rounds: RoundView[]; convergence: Convergence }) {
  const revealed = rounds.filter((r) => r.status === "revealed" && r.votes);
  if (revealed.length === 0) return null;
  const n = NUMERIC_CARDS.length;
  const w = LEFT + COL * revealed.length + 8;
  const h = TOP + ROW * (n - 1) + 36;
  const y = (card: number) => TOP + ROW * (n - 1 - NUMERIC_CARDS.indexOf(card as NumericCard));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Votes per round">
        {NUMERIC_CARDS.map((c) => (
          <g key={c}>
            <line x1={LEFT} x2={w - 4} y1={y(c)} y2={y(c)} className="grid" />
            <text x={LEFT - 6} y={y(c) + 4} textAnchor="end" className="axis">{c}</text>
          </g>
        ))}
        {revealed.map((r, i) => {
          const cx = LEFT + COL * i + COL / 2;
          const counts = new Map<number, number>();
          for (const c of Object.values(r.votes!)) if (typeof c === "number") counts.set(c, (counts.get(c) ?? 0) + 1);
          const nums = [...counts.keys()];
          const lo = Math.min(...nums), hi = Math.max(...nums);
          const special = Object.values(r.votes!).filter((c) => typeof c !== "number").length;
          return (
            <g key={r.number}>
              {nums.length > 0 && <line x1={cx} x2={cx} y1={y(hi)} y2={y(lo)} className="range" />}
              {[...counts.entries()].map(([card, k]) => (
                <g key={card}>
                  <circle cx={cx} cy={y(card)} r={5 + Math.min(k - 1, 4) * 2} className={r.stats?.agreed ? "dot-agreed" : "dot-vote"} />
                  {k > 1 && <text x={cx} y={y(card) + 3.5} textAnchor="middle" className="count">{k}</text>}
                </g>
              ))}
              <text x={cx} y={h - 20} textAnchor="middle" className="axis">R{r.number}</text>
              <text x={cx} y={h - 6} textAnchor="middle" className="axis small-score">{Math.round((convergence.scores[i] ?? 0) * 100)}%{special ? ` +${special}?` : ""}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="muted small">Dots = cards voted (number inside = how many). Percentage = convergence score of that round.</figcaption>
    </figure>
  );
}
