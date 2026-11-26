import type { TicketView } from "@/core/room";
import { ISSUE_KEY } from "./markdown";

export interface TicketSuggestion { key: string; title: string; hint: string }

/** An "@query" being typed right before the caret: where it starts and what was typed after "@". */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\w-]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/**
 * Tickets matching what follows "@": the one being estimated and the remaining ones first, then by
 * how well they match (key prefix, key, title). A complete Jira key that isn't in the session can
 * still be mentioned as is.
 */
export function ticketSuggestions(tickets: TicketView[], query: string, currentId: string | null, limit = 6): TicketSuggestion[] {
  const q = query.trim().toLowerCase();
  const scored: { t: TicketView; score: number }[] = [];
  for (const t of tickets) {
    if (!t.key) continue;
    const key = t.key.toLowerCase(), title = t.title.toLowerCase();
    let score = !q ? 1 : key.startsWith(q) ? 4 : key.includes(q) ? 3 : title.includes(q) ? 2 : 0;
    if (score === 0) continue;
    if (t.id === currentId) score += 0.6;
    else if (t.status === "open") score += 0.3;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, limit).map(({ t }) => ({
    key: t.key!, title: t.title,
    hint: t.id === currentId ? "now estimating" : t.status === "estimated" ? `estimated ${t.estimate ?? ""}`.trim() : "up next",
  }));
  const typed = query.toUpperCase();
  if (new RegExp(`^${ISSUE_KEY.source}$`).test(typed) && !out.some((s) => s.key === typed)) {
    out.push({ key: typed, title: "Mention this Jira issue", hint: "not in this session" });
  }
  return out;
}
