'use client';
import type { TicketView } from '@/core/view';
import { TREND_TEXT, cardLabel } from './cards';

/** Every revealed round of a ticket, with agreement trend: the record of how the team converged. */
export default function RoundHistory({ ticket }: { ticket: TicketView }) {
  const rounds = ticket.rounds.filter((r) => r.revealedAt !== null && r.stats && r.votes && r.voters);
  const conv = ticket.convergence;
  const trend = TREND_TEXT[conv.trend];
  if (rounds.length === 0) return null;

  const people = new Map<string, string>();
  rounds.forEach((r) => r.voters!.forEach((v) => people.set(v.id, v.name)));

  // Agreement chart: one point per round, 0..1.
  const W = 220, H = 56, pad = 8;
  const pts = conv.rounds.map((r, i) => {
    const x = conv.rounds.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (conv.rounds.length - 1);
    const y = H - pad - r.agreement * (H - 2 * pad);
    return { x, y, r };
  });

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>Rounds &amp; convergence</h3>
        <span className={`badge ${trend.tone}`}>{trend.label}</span>
      </header>
      <div className="history">
        <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Agreement per round">
          <line x1={pad} x2={W - pad} y1={pad} y2={pad} className="grid" />
          <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="grid" />
          {pts.length > 1 && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="line" />}
          {pts.map((p) => (
            <circle key={p.r.number} cx={p.x} cy={p.y} r={4} className={p.r.agreement === 1 ? 'dot full' : 'dot'}>
              <title>{`Round ${p.r.number}: agreement ${Math.round(p.r.agreement * 100)}%, spread ${p.r.spreadSteps ?? '–'} steps`}</title>
            </circle>
          ))}
        </svg>
        <div className="scroll-x">
          <table className="rounds">
            <thead>
              <tr>
                <th>Voter</th>
                {rounds.map((r) => <th key={r.number}>R{r.number}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...people].map(([id, name]) => (
                <tr key={id}>
                  <td>{name}</td>
                  {rounds.map((r) => {
                    const v = r.votes![id];
                    return <td key={r.number} className={v === undefined ? 'none' : ''}>{v === undefined ? '–' : cardLabel(v)}</td>;
                  })}
                </tr>
              ))}
              <tr className="foot">
                <td>Spread</td>
                {rounds.map((r) => <td key={r.number}>{r.stats!.spreadSteps ?? '–'}</td>)}
              </tr>
              <tr className="foot">
                <td>Agreement</td>
                {rounds.map((r) => <td key={r.number}>{Math.round(r.stats!.agreement * 100)}%</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
