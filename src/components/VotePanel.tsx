"use client";
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

  return (
    <section className="panel vote-panel">
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
