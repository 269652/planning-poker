import type { RoomView, TicketView } from "@/core/room";

export interface TicketQueue {
  current: TicketView | null;
  /** Open tickets still to estimate, in the order `nextTicket` visits them. */
  upNext: TicketView[];
  /** Estimated tickets other than the current one. */
  done: TicketView[];
  next: TicketView | null;
}

export function ticketQueue(view: RoomView): TicketQueue {
  const list = view.tickets;
  const at = list.findIndex((t) => t.id === view.currentTicketId);
  const current = at >= 0 ? list[at] : null;
  const order = at < 0 ? list : [...list.slice(at + 1), ...list.slice(0, at)];
  const upNext = order.filter((t) => t.status === "open");
  const done = list.filter((t) => t.status === "estimated" && t !== current);
  return { current, upNext, done, next: upNext[0] ?? null };
}
