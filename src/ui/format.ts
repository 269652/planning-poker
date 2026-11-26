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

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** `siteUrl` = origin + base path. The code is in the #fragment, so a static host serves one page for all rooms. */
export function joinUrlFor(siteUrl: string, roomId: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/room/#${roomId}`;
}
