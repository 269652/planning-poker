"use client";
import { useEffect, useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";

const COOLDOWN_MS = 10_000;

/** People in the room; while voting, anyone can ping those who haven't voted yet (they hear a chime). */
export default function ParticipantsPanel({ view, voting, send }: {
  view: RoomView; voting: boolean; send: (m: ClientMessage) => void;
}) {
  const voters = view.participants.filter((p) => p.role === "voter" && p.connected);
  const voted = voters.filter((p) => p.hasVoted).length;
  const left = view.participants.filter((p) => !p.connected).length;
  const waiting = voting ? voters.filter((p) => !p.hasVoted && p.id !== view.you) : [];
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, rerender] = useState(0);
  const coolingDown = cooldownUntil > Date.now();

  useEffect(() => {
    if (!coolingDown) return;
    const t = setTimeout(() => rerender((n) => n + 1), cooldownUntil - Date.now() + 50);
    return () => clearTimeout(t);
  }, [coolingDown, cooldownUntil]);

  const ping = (participantId?: string) => {
    send({ type: "nudge", participantId });
    setCooldownUntil(Date.now() + COOLDOWN_MS);
  };

  return (
    <section className="panel">
      <div className="ticket-head">
        <h2>People <span className="muted small">{voted}/{voters.length} voted</span></h2>
        {waiting.length > 0 && (
          <button
            className="small ping-all"
            disabled={coolingDown}
            title={coolingDown ? "You can ping again in a few seconds" : `Play a chime for everyone who hasn't voted yet (${waiting.length})`}
            onClick={() => ping()}
          >
            🔔 Ping {waiting.length === 1 ? waiting[0].name : `${waiting.length} who haven't voted`}
          </button>
        )}
      </div>
      <ul className="people">
        {view.participants.filter((p) => p.connected).map((p) => {
          const canPing = waiting.some((w) => w.id === p.id);
          return (
            <li key={p.id} data-participant={p.id} className={`${p.connected ? "" : "offline"} ${p.handRaised ? "hand-up" : ""}`}>
              <span className={`dot ${p.connected ? "on" : "off"}`} />
              <span className="grow">
                {p.handRaised && <span className="hand" title="Hand raised — wants to say something">✋ </span>}
                {p.name}{p.id === view.you ? " (you)" : ""}
                {p.isHost && <span className="badge">host</span>}
                {p.role === "observer" && <span className="badge">observer</span>}
              </span>
              {p.role === "voter" && p.hasVoted && <span title="voted">✓</span>}
              {canPing && (
                <button
                  className="link ping"
                  disabled={coolingDown}
                  title={coolingDown ? "You can ping again in a few seconds" : `Ping ${p.name}: plays a chime for them`}
                  aria-label={`Ping ${p.name}`}
                  onClick={() => ping(p.id)}
                >
                  🔔
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {left > 0 && <p className="muted small left-note">{left === 1 ? "1 person has left" : `${left} people have left`} — back as soon as they open the room again.</p>}
    </section>
  );
}
