import type { Card } from "@/core/deck";
import type { Trend } from "@/core/convergence";
import type { Writeback } from "@/core/room";

export function cardLabel(card: Card | null | undefined): string {
  if (card === null || card === undefined) return "–";
  return card === "coffee" ? "☕" : String(card);
}

export type Tone = "good" | "bad" | "neutral";

export function trendLabel(trend: Trend): { text: string; tone: Tone } {
  switch (trend) {
    case "agreed": return { text: "Agreement reached", tone: "good" };
    case "converging": return { text: "Converging", tone: "good" };
    case "diverging": return { text: "Diverging", tone: "bad" };
    case "stalled": return { text: "No progress", tone: "bad" };
    case "first": return { text: "First round", tone: "neutral" };
    default: return { text: "Not started", tone: "neutral" };
  }
}

export function writebackLabel(wb: Writeback): string | null {
  switch (wb.status) {
    case "pending": return "Writing to Jira…";
    case "synced": return "Saved to Jira";
    case "failed": return `Jira write-back failed: ${wb.error ?? "unknown error"}`;
    default: return null;
  }
}

export function joinUrlFor(origin: string, roomId: string): string {
  return `${origin}/room/${roomId}`;
}

export function wsUrlFor(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/ws`;
}
