"use client";
import { NUMERIC_CARDS } from "@/core/deck";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView, TicketView } from "@/core/room";
import { cardLabel, writebackLabel } from "@/ui/format";
import { cardPattern } from "@/ui/cardPattern";
import ConvergenceChart from "./ConvergenceChart";
import TicketCard from "./TicketCard";

interface Props {
  view: RoomView; ticket: TicketView | null; next: TicketView | null; remaining: number;
  isHost: boolean; send: (m: ClientMessage) => void;
}

export default function RoundPanel({ view, ticket, next, remaining, isHost, send }: Props) {
  if (!ticket) {
    return (
      <section className="panel center">
        <h2>No ticket selected</h2>
        <p className="muted">
          {remaining > 0
            ? `${remaining} ticket${remaining === 1 ? "" : "s"} waiting to be estimated.`
            : isHost ? "Import tickets from Jira or add one to get started." : "Waiting for the host to add tickets."}
        </p>
        {isHost && next && <button className="primary" onClick={() => send({ type: "nextTicket" })}>Start with {next.key ?? next.title}</button>}
        {!isHost && remaining > 0 && <p className="muted small">Waiting for the host to start.</p>}
      </section>
    );
  }

  const round = ticket.rounds[ticket.rounds.length - 1];
  const revealed = round?.status === "revealed";
  const estimated = ticket.status === "estimated";
  const voters = view.participants.filter((p) => p.role === "voter" && p.connected);
  const votedCount = voters.filter((p) => p.hasVoted).length;
  const stats = revealed ? round.stats : null;
  const wb = writebackLabel(ticket.writeback);
  const nextLabel = next ? `Next ticket: ${next.key ?? next.title}` : null;

  return (
    <>
      <TicketCard ticket={ticket} roundNumber={round?.number ?? 1} />

      {estimated && (
        <section className="panel result">
          <div className="result-row">
            <div>
              <h3>Estimate</h3>
              <div className="big">{ticket.estimate}</div>
              <p className="muted small">
                {ticket.resolution === "override" ? "Set by the host" : "Agreed by the team"} after {ticket.rounds.filter((r) => r.status === "revealed").length} round(s).
              </p>
              {wb && <p className={`wb ${ticket.writeback.status}`}>{wb}</p>}
            </div>
            {isHost && (
              <div className="controls column">
                {next
                  ? <button className="primary" onClick={() => send({ type: "nextTicket" })}>{nextLabel} →</button>
                  : <p className="good small">All tickets in this session are estimated. 🎉</p>}
                {ticket.writeback.status === "failed" && <button onClick={() => send({ type: "retryWriteback", ticketId: ticket.id })}>Retry Jira write-back</button>}
                <button onClick={() => send({ type: "reopen", ticketId: ticket.id })}>Re-estimate</button>
              </div>
            )}
            {!isHost && next && <p className="muted small">Waiting for the host to move on to {next.key ?? next.title}…</p>}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="ticket-head">
          <h3>Table</h3>
          {!estimated && <span className="muted small">{revealed ? "Votes revealed" : `${votedCount}/${voters.length} voted`}</span>}
        </div>
        <div className="table">
          {view.participants.filter((p) => p.role === "voter").map((p) => {
            const vote = revealed ? round.votes?.[p.id] : undefined;
            const has = round?.voted.includes(p.id);
            // Same card ⇒ same procedural back (new every round); the value stays hidden until reveal.
            const patternId = round?.patterns?.[p.id];
            const back = patternId ? cardPattern(patternId) : null;
            const style = back
              ? vote !== undefined ? { borderColor: back.accent } : { backgroundImage: back.backgroundImage, borderColor: back.accent }
              : undefined;
            return (
              <div key={p.id} className={`seat ${p.connected ? "" : "offline"}`}>
                <div className={`face ${vote !== undefined ? "up" : has ? "down" : "empty"} ${back ? "patterned" : ""}`} style={style}>
                  {vote !== undefined ? cardLabel(vote) : has ? "" : "…"}
                </div>
                <span className="small">{p.handRaised && <span title="Hand raised" aria-label="hand raised">✋ </span>}{p.name}</span>
              </div>
            );
          })}
        </div>

        {stats && (
          <dl className="stats">
            <div><dt>Min – Max</dt><dd>{cardLabel(stats.min)} – {cardLabel(stats.max)}</dd></div>
            <div><dt>Median</dt><dd>{stats.median ?? "–"}</dd></div>
            <div><dt>Mean</dt><dd>{stats.mean !== null ? stats.mean.toFixed(1) : "–"}</dd></div>
            <div><dt>Spread</dt><dd>{stats.spreadSteps ?? "–"} step{stats.spreadSteps === 1 ? "" : "s"}</dd></div>
            <div><dt>Most votes</dt><dd>{cardLabel(stats.modeCard)} ({Math.round(stats.modeShare * 100)}%)</dd></div>
            {(stats.questionCount > 0 || stats.coffeeCount > 0) && <div><dt>? / ☕</dt><dd>{stats.questionCount} / {stats.coffeeCount}</dd></div>}
          </dl>
        )}

        {isHost && !estimated && (
          <div className="controls">
            {!revealed && <button className="primary" onClick={() => send({ type: "reveal" })} disabled={votedCount === 0}>Reveal votes ({votedCount}/{voters.length})</button>}
            {revealed && stats?.agreed && (
              <button className="primary" onClick={() => send({ type: "finalize" })}>
                Accept {stats.agreedEstimate}{ticket.source === "jira" ? " & write to Jira" : ""}
              </button>
            )}
            {revealed && <button onClick={() => send({ type: "nextRound" })}>{stats?.agreed ? "Play another round" : "Discuss, then next round"}</button>}
            {next && <button className="link small" onClick={() => send({ type: "nextTicket" })} title="Leave this ticket open and continue with the next one">Skip to {next.key ?? next.title}</button>}
            {revealed && !stats?.agreed && (
              <details className="override">
                <summary>No agreement — set the estimate manually</summary>
                <div className="deck small-deck">
                  {NUMERIC_CARDS.map((c) => <button key={c} className="card" onClick={() => send({ type: "finalize", value: c })}>{c}</button>)}
                </div>
              </details>
            )}
          </div>
        )}
        {!isHost && !estimated && revealed && <p className="muted small">Waiting for the host to continue…</p>}
      </section>

      {ticket.rounds.some((r) => r.status === "revealed") && (
        <section className="panel">
          <h3>Round history & convergence</h3>
          <ConvergenceChart rounds={ticket.rounds} convergence={ticket.convergence} />
          <ol className="history">
            {ticket.rounds.filter((r) => r.status === "revealed").map((r) => (
              <li key={r.number}>
                <strong>Round {r.number}</strong>{" "}
                {Object.entries(r.votes ?? {}).map(([pid, c]) => {
                  const p = view.participants.find((x) => x.id === pid);
                  return <span key={pid} className="vote-pill" title={p?.name}>{p?.name.split(" ")[0]}: {cardLabel(c)}</span>;
                })}
                {r.stats?.agreed && <span className="chip good">agreed {r.stats.agreedEstimate}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
