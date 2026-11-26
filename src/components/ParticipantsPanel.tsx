"use client";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";

export default function ParticipantsPanel({ view, isHost, send }: { view: RoomView; isHost: boolean; send: (m: ClientMessage) => void }) {
  const voters = view.participants.filter((p) => p.role === "voter" && p.connected);
  const voted = voters.filter((p) => p.hasVoted).length;
  return (
    <section className="panel">
      <h2>People <span className="muted small">{voted}/{voters.length} voted</span></h2>
      <ul className="people">
        {view.participants.map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            <span className="grow">
              {p.name}{p.id === view.you ? " (you)" : ""}
              {p.isHost && <span className="badge">host</span>}
              {p.role === "observer" && <span className="badge">observer</span>}
            </span>
            {p.role === "voter" && p.hasVoted && <span title="voted">✓</span>}
            {isHost && !p.isHost && p.connected && (
              <button className="link" onClick={() => send({ type: "promote", participantId: p.id })}>make host</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
