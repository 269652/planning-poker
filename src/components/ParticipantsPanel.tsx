"use client";
import type { RoomView } from "@/core/room";

export default function ParticipantsPanel({ view }: { view: RoomView }) {
  const voters = view.participants.filter((p) => p.role === "voter" && p.connected);
  const voted = voters.filter((p) => p.hasVoted).length;
  return (
    <section className="panel">
      <h2>People <span className="muted small">{voted}/{voters.length} voted</span></h2>
      <ul className="people">
        {view.participants.map((p) => (
          <li key={p.id} data-participant={p.id} className={`${p.connected ? "" : "offline"} ${p.handRaised ? "hand-up" : ""}`}>
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            <span className="grow">
              {p.handRaised && <span className="hand" title="Hand raised — wants to say something">✋ </span>}
              {p.name}{p.id === view.you ? " (you)" : ""}
              {p.isHost && <span className="badge">host</span>}
              {p.role === "observer" && <span className="badge">observer</span>}
            </span>
            {p.role === "voter" && p.hasVoted && <span title="voted">✓</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
