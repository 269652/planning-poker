"use client";
import { useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView, TicketView } from "@/core/room";
import { cardLabel, writebackLabel } from "@/ui/format";
import type { TicketQueue } from "@/ui/queue";

function matches(t: TicketView, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return t.title.toLowerCase().includes(s) || (t.key?.toLowerCase().includes(s) ?? false);
}

function TicketItem({ t, isHost, current, position, send }: {
  t: TicketView; isHost: boolean; current?: boolean; position?: number; send: (m: ClientMessage) => void;
}) {
  const wb = writebackLabel(t.writeback);
  const rounds = t.rounds.filter((r) => r.status === "revealed").length;
  return (
    <li className={`${current ? "current" : ""} ${t.status === "estimated" ? "estimated" : ""}`}>
      <button
        className="ticket-btn" disabled={!isHost || current}
        onClick={() => send({ type: "selectTicket", ticketId: t.id })}
        title={isHost && !current ? "Estimate this ticket now" : undefined}
        aria-current={current ? "true" : undefined}
      >
        <span className="ticket-head">
          <span className="ticket-id">
            {position !== undefined && <span className="pos">{position}</span>}
            {current && <span className="live" aria-hidden>●</span>}
            {t.key ? <span className="key">{t.key}</span> : <span className="key muted">manual</span>}
            {t.issueType && <span className="muted small">{t.issueType}</span>}
          </span>
          <span className={`est ${t.status === "estimated" ? "done" : ""}`}>
            {t.status === "estimated" ? cardLabel(t.estimate) : t.currentEstimate !== null ? `was ${t.currentEstimate}` : ""}
          </span>
        </span>
        <span className="ticket-title">{t.title}</span>
        {rounds > 0 && t.status !== "estimated" && <span className="muted small">{rounds} round(s) played</span>}
      </button>
      {wb && <div className={`small wb ${t.writeback.status}`}>{wb}</div>}
      {isHost && (
        <div className="row small ticket-actions">
          {t.writeback.status === "failed" && <button className="link" onClick={() => send({ type: "retryWriteback", ticketId: t.id })}>retry</button>}
          <button className="link" onClick={() => send({ type: "removeTicket", ticketId: t.id })}>remove</button>
        </div>
      )}
    </li>
  );
}

export default function TicketList({ view, queue, isHost, send, onImport }: {
  view: RoomView; queue: TicketQueue; isHost: boolean; send: (m: ClientMessage) => void; onImport: () => void;
}) {
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const total = view.tickets.length;
  const estimated = view.tickets.filter((t) => t.status === "estimated").length;
  const upNext = queue.upNext.filter((t) => matches(t, filter));
  const done = queue.done.filter((t) => matches(t, filter));

  return (
    <section className="panel queue">
      <div className="ticket-head">
        <h2>Tickets</h2>
        <span className="muted small">{estimated}/{total} estimated</span>
      </div>
      {total > 0 && <span className="progress"><span style={{ width: `${total ? (estimated / total) * 100 : 0}%` }} /></span>}

      {queue.current && (
        <>
          <h4 className="queue-label">Now estimating</h4>
          <ul className="tickets"><TicketItem t={queue.current} current isHost={isHost} send={send} /></ul>
        </>
      )}

      <div className="ticket-head queue-label-row">
        <h4 className="queue-label">Up next <span className="count">{queue.upNext.length}</span></h4>
      </div>
      {total > 3 && (
        <input className="filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by key or title…" aria-label="Filter tickets" />
      )}
      <ul className="tickets">
        {upNext.map((t, i) => <TicketItem key={t.id} t={t} position={i + 1} isHost={isHost} send={send} />)}
        {queue.upNext.length === 0 && (
          <li className="empty muted small">
            {total === 0 ? (isHost ? "No tickets yet. Import from Jira or add one." : "No tickets yet. Waiting for the host.") : "Nothing left to estimate."}
          </li>
        )}
        {queue.upNext.length > 0 && upNext.length === 0 && <li className="empty muted small">No remaining ticket matches “{filter}”.</li>}
      </ul>

      {queue.done.length > 0 && (
        <>
          <button className="link queue-toggle" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
            {showDone ? "▾" : "▸"} Estimated ({queue.done.length})
          </button>
          {showDone && <ul className="tickets">{done.map((t) => <TicketItem key={t.id} t={t} isHost={isHost} send={send} />)}</ul>}
        </>
      )}

      {isHost && (
        <div className="queue-add">
          <button className="wide primary" onClick={onImport}>Import from Jira…</button>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { send({ type: "addTicket", title }); setTitle(""); } }}>
            <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a manual ticket…" maxLength={300} />
            <button disabled={!title.trim()}>Add</button>
          </form>
        </div>
      )}
    </section>
  );
}
