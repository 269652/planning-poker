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
  // The whole sheet is the swipe area, cards included: a vertical drag moves the sheet, a tap still
  // plays a card (or raises your hand). A drag only starts after a few pixels of mostly-vertical
  // movement, and the click that follows a drag is swallowed.
  const gesture = useRef<{ x: number; y: number; t: number; lastY: number; dragging: boolean } | null>(null);
  const swiped = useRef(false);
  const roundKey = `${ticket?.id}:${round?.number}`;
  useEffect(() => { setStashed(false); }, [roundKey]);

  const onDown = (e: React.PointerEvent) => {
    if (!window.matchMedia("(max-width: 640px)").matches || (e.pointerType === "mouse" && e.button !== 0)) return;
    gesture.current = { x: e.clientX, y: e.clientY, t: performance.now(), lastY: e.clientY, dragging: false };
    swiped.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.lastY = e.clientY;
    const dy = e.clientY - g.y, dx = e.clientX - g.x;
    if (!g.dragging) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
      g.dragging = true;
      // Keep receiving moves even when the finger/mouse leaves the sheet.
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* already released */ }
    }
    setDrag(dy);
  };
  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.dragging) return; // a tap: buttons handle it
    const dy = g.lastY - g.y;
    const speed = dy / Math.max(1, performance.now() - g.t); // px per ms
    setDrag(null);
    swiped.current = true;
    if (dy > 50 || speed > 0.5) setStashed(true);
    else if (dy < -50 || speed < -0.5) setStashed(false);
  };
  // While dragging, the sheet follows the finger (never above its open position).
  const dragStyle = drag === null ? undefined : {
    transform: stashed ? `translateY(calc(100% - var(--sheet-peek) + ${Math.min(0, drag)}px))` : `translateY(${Math.max(0, drag)}px)`,
    transition: "none",
  };

  return (
    <section
      className={`panel vote-panel ${isObserver ? "observing" : ""} ${stashed ? "stashed" : ""} ${drag !== null ? "dragging" : ""}`}
      style={dragStyle}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onClickCapture={(e) => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } }}
    >
      <div className="sheet-grip">
        <button
          type="button" className="sheet-handle" aria-label={stashed ? "Show your cards" : "Hide your cards"} aria-expanded={!stashed}
          onClick={() => setStashed((s) => !s)}
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
          Your card&apos;s back this round. Everyone&apos;s back is different, so nobody can tell who picked what.
        </p>
      )}
    </section>
  );
}
