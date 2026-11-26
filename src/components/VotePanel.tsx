"use client";
import { useEffect, useRef, useState } from "react";
import { DECK } from "@/core/deck";
import type { ClientMessage } from "@/core/protocol";
import type { ParticipantView, TicketView } from "@/core/room";
import { pulseFrom } from "@/scenes/bus";
import { cardPattern } from "@/ui/cardPattern";
import { cardLabel } from "@/ui/format";

/** The card deck (right sidebar), your card's back for this round, and raising your hand. */
export default function VotePanel({ ticket, me, send }: {
  ticket: TicketView | null; me: ParticipantView | null; send: (m: ClientMessage) => void;
}) {
  const isObserver = me?.role === "observer";
  const round = ticket?.rounds[ticket.rounds.length - 1];
  const revealed = round?.status === "revealed";
  const closed = !ticket || ticket.status === "estimated";
  const myPattern = me && round?.patterns?.[me.id] ? cardPattern(round.patterns[me.id]) : null;
  const hint = !ticket ? "Waiting for a ticket"
    : ticket.status === "estimated" ? `Estimated: ${ticket.estimate}`
    : isObserver ? "You are observing"
    : revealed ? "Votes are revealed"
    : round?.myVote != null ? `Your vote: ${cardLabel(round.myVote)} — you can still change it`
    : "Pick your card";

  // Phones: the deck is a bottom sheet you can stash with a swipe down (and bring back with a swipe
  // up or a tap). It comes back by itself when a new round or ticket starts.
  const [stashed, setStashed] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const swiped = useRef(false);
  const roundKey = `${ticket?.id}:${round?.number}`;
  useEffect(() => { setStashed(false); }, [roundKey]);

  const onDown = (e: React.PointerEvent) => {
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    // The raise-hand button keeps working as a plain button.
    if ((e.target as HTMLElement).closest("button:not(.sheet-handle)")) return;
    start.current = { y: e.clientY, t: performance.now() };
    swiped.current = false;
  };
  const onMove = (e: React.PointerEvent) => { if (start.current) setDrag(e.clientY - start.current.y); };
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    const speed = dy / Math.max(1, performance.now() - start.current.t); // px per ms
    start.current = null;
    setDrag(null);
    if (Math.abs(dy) < 6) return; // a tap: the handle's onClick toggles
    swiped.current = true;
    if (dy > 40 || speed > 0.5) setStashed(true);
    else if (dy < -40 || speed < -0.5) setStashed(false);
  };
  // While dragging, the sheet follows the finger (never above its open position).
  const dragStyle = drag === null ? undefined : {
    transform: stashed ? `translateY(calc(100% - var(--sheet-peek) + ${Math.min(0, drag)}px))` : `translateY(${Math.max(0, drag)}px)`,
    transition: "none",
  };

  return (
    <section className={`panel vote-panel ${isObserver ? "observing" : ""} ${stashed ? "stashed" : ""}`} style={dragStyle}>
      <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <button
          type="button" className="sheet-handle" aria-label={stashed ? "Show your cards" : "Hide your cards"} aria-expanded={!stashed}
          onClick={() => { if (swiped.current) { swiped.current = false; return; } setStashed((s) => !s); }}
        />
      <div className="ticket-head">
        <h3>Your card</h3>
        {me && (
          <button
            className={`hand-btn ${me.handRaised ? "raised" : ""}`}
            aria-pressed={me.handRaised}
            title={me.handRaised ? "Lower your hand" : "Raise your hand: you want to say something before the team moves on"}
            onClick={(e) => { pulseFrom(e.currentTarget, 1.1, 0.12); send({ type: "raiseHand", raised: !me.handRaised }); }}
          >
            ✋ {me.handRaised ? "Lower hand" : "Raise hand"}
          </button>
        )}
      </div>
      <p className="muted small">{hint}</p>
      </div>
      <div className="deck sidebar-deck">
        {DECK.map((c, i) => (
          <button
            key={String(c)}
            className={`card ${round?.myVote === c ? "selected" : ""}`}
            disabled={closed || isObserver || revealed}
            onClick={(e) => { pulseFrom(e.currentTarget, 1, i / DECK.length); send({ type: "vote", card: c }); }}
            aria-pressed={round?.myVote === c}
            aria-label={c === "coffee" ? "coffee break" : `card ${c}`}
          >
            {cardLabel(c)}
          </button>
        ))}
      </div>
      {myPattern && !revealed && (
        <p className="my-back small">
          <span className="back-swatch" style={{ backgroundImage: myPattern.backgroundImage, borderColor: myPattern.accent }} />
          Your card&apos;s back this round — the same back on the table means the same card.
        </p>
      )}
    </section>
  );
}
