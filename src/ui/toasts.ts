import type { RoomView } from "@/core/room";
import type { Tone } from "./format";

export interface Toast { id: string; tone: Tone; message: string }

/**
 * Toasts for Jira write-backs that settled between two consecutive room states. The first state
 * after joining (prev = null) yields nothing, so old results are not replayed to newcomers.
 */
export function writebackToasts(prev: RoomView | null, next: RoomView): Toast[] {
  if (!prev) return [];
  const out: Toast[] = [];
  for (const t of next.tickets) {
    const before = prev.tickets.find((p) => p.id === t.id);
    if (!before || before.writeback.status === t.writeback.status) continue;
    const label = t.key ?? t.title;
    if (t.writeback.status === "synced") {
      out.push({ id: `${t.id}:synced`, tone: "good", message: `${label}: ${t.estimate} points written to Jira` });
    } else if (t.writeback.status === "failed") {
      out.push({ id: `${t.id}:failed`, tone: "bad", message: `${label}: Jira write-back failed — ${t.writeback.error ?? "unknown error"}` });
    }
  }
  return out;
}
