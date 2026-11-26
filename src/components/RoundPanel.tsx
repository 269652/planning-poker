"use client";
import { DECK, NUMERIC_CARDS } from "@/core/deck";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView, TicketView } from "@/core/room";
import { cardLabel, trendLabel, writebackLabel } from "@/ui/format";
import ConvergenceChart from "./ConvergenceChart";

interface Props {
  view: RoomView; ticket: TicketView | null; isHost: boolean; isObserver: boolean; send: (m: ClientMessage) => void;
}

export default function RoundPanel({ view, ticket, isHost, isObserver, send }: Props) {
  if (!ticket) {
    return (
      <section className="panel center">
        <h2>No ticket selected</h2>
        <p className="muted">{isHost ? "Pick a ticket from the list to start estimating." : "Waiting for the host to pick a ticket."}</p>
      </section>
    );
  }

  const round = ticket.rounds[ticket.rounds.length - 1];
  const revealed = round?.status === "revealed";
  const estimated = ticket.status === "estimated";
  const voters = view.participants.filter((p) => p.role === "voter" && p.connected);
  const votedCount = voters.filter((p) => p.hasVoted).length;
  const stats = revealed ? round.stats : null;
  const trend = trendLabel(ticket.convergence.trend);
  const wb = writebackLabel(ticket.writeback);

  return (
    <>
      <section className="panel">
        <div className="ticket-head">
          {ticket.key && (ticket.url ? <a className="key" href={ticket.url} target="_blank" rel="noreferrer">{ticket.key}</a> : <span className="key">{ticket.key}</span>)}
          <span className={`chip ${trend.tone}`}>{trend.text}</span>
          <span className="muted small">Round {round?.number ?? 1}</span>
        </div>
        <h2>{ticket.title}</h2>
        {ticket.description && <p className="desc">{ticket.description}</p>}
        {ticket.currentEstimate !== null && <p className="muted small">Currently {ticket.currentEstimate} points in Jira</p>}
      </section>

      {!estimated && (
        <section className="panel">
          <h3>{isObserver ? "Observing" : revealed ? "Votes are in" : "Pick your card"}</h3>
          <div className="deck">
            {DECK.map((c) => (
              <button
                key={String(c)}
                className={`card ${round?.myVote === c ? "selected" : ""}`}
                disabled={isObserver || revealed}
                onClick={() => send({ type: "vote", card: c })}
                aria-pressed={round?.myVote === c}
                aria-label={c === "coffee" ? "coffee break" : `card ${c}`}
              >
                {cardLabel(c)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Table</h3>
        <div className="table">
          {view.participants.filter((p) => p.role === "voter").map((p) => {
            const vote = revealed ? round.votes?.[p.id] : undefined;
            const has = round?.voted.includes(p.id);
            return (
              <div key={p.id} className={`seat ${p.connected ? "" : "offline"}`}>
                <div className={`face ${vote !== undefined ? "up" : has ? "down" : "empty"}`}>
                  {vote !== undefined ? cardLabel(vote) : has ? "" : "…"}
                </div>
                <span className="small">{p.name}</span>
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

      {estimated && (
        <section className="panel result">
          <h3>Estimate</h3>
          <div className="big">{ticket.estimate}</div>
          <p className="muted small">
            {ticket.resolution === "override" ? "Set by the host" : "Agreed by the team"} after {ticket.rounds.filter((r) => r.status === "revealed").length} round(s).
          </p>
          {wb && <p className={`wb ${ticket.writeback.status}`}>{wb}</p>}
          {isHost && (
            <div className="controls">
              {ticket.writeback.status === "failed" && <button className="primary" onClick={() => send({ type: "retryWriteback", ticketId: ticket.id })}>Retry Jira write-back</button>}
              <button onClick={() => send({ type: "reopen", ticketId: ticket.id })}>Re-estimate</button>
            </div>
          )}
        </section>
      )}

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
