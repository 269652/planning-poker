import type { Ticket } from "@/core/room";

/**
 * Plain-text comment documenting how the estimate came about. Votes are shown as
 * an anonymous distribution, never with voter names.
 */
export function formatEstimateComment(ticket: Ticket, roomName: string): string {
  const revealed = ticket.rounds.filter((r) => r.status === "revealed");
  const how = ticket.resolution === "override" ? "set by the facilitator" : "agreement";
  const lines = [
    `Planning Poker estimate: ${ticket.estimate} story points (${how} after ${revealed.length} round${revealed.length === 1 ? "" : "s"}) - ${roomName}`,
  ];
  for (const r of revealed) {
    const counts = new Map<string, number>();
    for (const c of Object.values(r.votes)) counts.set(String(c), (counts.get(String(c)) ?? 0) + 1);
    const dist = [...counts.entries()]
      .sort((a, b) => (Number.isNaN(+a[0]) ? 1 : Number.isNaN(+b[0]) ? -1 : +a[0] - +b[0]))
      .map(([card, n]) => (n > 1 ? `${card} x${n}` : card))
      .join(", ");
    const spread = r.stats?.spreadSteps;
    lines.push(`Round ${r.number}: ${dist}${spread != null ? ` (spread ${spread} step${spread === 1 ? "" : "s"})` : ""}`);
  }
  return lines.join("\n");
}
