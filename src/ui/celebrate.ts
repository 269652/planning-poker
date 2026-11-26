import type { RoomView } from "@/core/room";

/**
 * Did a round just get revealed in which everyone played the same card, on the first try?
 * Returns the ticket id to celebrate, or null. Needs at least two votes (agreeing with yourself
 * is no feat), and fires only on the transition, so re-renders and reconnects don't repeat it.
 */
export function firstTryUnanimous(prev: RoomView | null, next: RoomView): string | null {
  if (!prev) return null;
  for (const t of next.tickets) {
    if (t.rounds.length !== 1) continue;
    const round = t.rounds[0];
    if (round.status !== "revealed" || !round.votes) continue;
    const before = prev.tickets.find((p) => p.id === t.id)?.rounds[0];
    if (!before || before.status !== "voting") continue;
    const cards = Object.values(round.votes);
    if (cards.length >= 2 && cards.every((c) => c === cards[0])) return t.id;
  }
  return null;
}
