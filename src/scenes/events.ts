import type { RoomView } from "@/core/room";
import type { SceneEvent } from "./bus";

/** Turns consecutive room states into background moods. The first state (joining) stays quiet. */
export function sceneEventsFor(prev: RoomView | null, next: RoomView): SceneEvent[] {
  if (!prev) return [];
  const out: SceneEvent[] = [];
  if (prev.currentTicketId !== next.currentTicketId && prev.currentTicketId !== null && next.currentTicketId !== null) {
    out.push({ kind: "next-scene" });
  }
  const before = prev.tickets.find((t) => t.id === next.currentTicketId);
  const now = next.tickets.find((t) => t.id === next.currentTicketId);
  if (before && now && prev.currentTicketId === next.currentTicketId) {
    const rb = before.rounds[before.rounds.length - 1];
    const rn = now.rounds[now.rounds.length - 1];
    if (now.rounds.length > before.rounds.length) out.push({ kind: "new-round" });
    else if (rb?.status === "voting" && rn?.status === "revealed" && rn.stats) {
      out.push({ kind: "reveal", agreed: rn.stats.agreed, spread: rn.stats.spreadSteps ?? 0 });
    }
    if (before.status === "open" && now.status === "estimated") out.push({ kind: "settle" });
    if (before.writeback.status !== "synced" && now.writeback.status === "synced") out.push({ kind: "shimmer" });
  }
  const online = (v: RoomView) => v.participants.filter((p) => p.connected).length;
  if (online(next) > online(prev)) out.push({ kind: "sparkle" });
  for (const p of next.participants) {
    const was = prev.participants.find((x) => x.id === p.id);
    if (p.handRaised && !was?.handRaised) out.push({ kind: "hand", participantId: p.id });
  }
  return out;
}
