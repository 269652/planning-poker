"use client";
import { useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";
import { cardLabel, writebackLabel } from "@/ui/format";

export default function TicketList({ view, isHost, send, onImport }: {
  view: RoomView; isHost: boolean; send: (m: ClientMessage) => void; onImport: () => void;
}) {
  const [title, setTitle] = useState("");
  const done = view.tickets.filter((t) => t.status === "estimated").length;
  return (
    <section className="panel">
      <h2>Tickets <span className="muted small">{done}/{view.tickets.length} estimated</span></h2>
      <ul className="tickets">
        {view.tickets.map((t) => {
          const wb = writebackLabel(t.writeback);
          return (
            <li key={t.id} className={t.id === view.currentTicketId ? "current" : ""}>
              <button className="ticket-btn" disabled={!isHost} onClick={() => send({ type: "selectTicket", ticketId: t.id })}>
                <span className="ticket-head">
                  {t.key && <span className="key">{t.key}</span>}
                  <span className={`est ${t.status === "estimated" ? "done" : ""}`}>
                    {t.status === "estimated" ? cardLabel(t.estimate) : t.currentEstimate !== null ? `was ${t.currentEstimate}` : ""}
                  </span>
                </span>
                <span className="ticket-title">{t.title}</span>
                {t.rounds.length > 0 && <span className="muted small">{t.rounds.filter((r) => r.status === "revealed").length} round(s)</span>}
              </button>
              {wb && <div className={`small wb ${t.writeback.status}`}>{wb}</div>}
              {isHost && (
                <div className="row small">
                  {t.writeback.status === "failed" && <button className="link" onClick={() => send({ type: "retryWriteback", ticketId: t.id })}>retry</button>}
                  <button className="link" onClick={() => send({ type: "removeTicket", ticketId: t.id })}>remove</button>
                </div>
              )}
            </li>
          );
        })}
        {view.tickets.length === 0 && <li className="muted small">No tickets yet.{isHost ? " Add one or import from Jira." : " Waiting for the host."}</li>}
      </ul>
      {isHost && (
        <>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { send({ type: "addTicket", title }); setTitle(""); } }}>
            <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add ticket title…" maxLength={300} />
            <button disabled={!title.trim()}>Add</button>
          </form>
          <button className="wide" onClick={onImport}>Import from Jira…</button>
        </>
      )}
    </section>
  );
}
