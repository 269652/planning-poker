import type { Ticket } from './room';

export interface TicketSummary {
  estimate: number;
  roundCount: number;
  resolution: 'consensus' | 'forced';
  /** Human-readable lines, suitable for a Jira comment. */
  lines: string[];
}

const label = (c: unknown) => (c === 'coffee' ? 'coffee' : String(c));

/** Summarise an agreed ticket, including every revealed round. */
export function summarizeTicket(ticket: Ticket): TicketSummary {
  if (ticket.status !== 'agreed' || ticket.estimate === null || !ticket.resolution) {
    throw new Error('Ticket has no agreed estimate');
  }
  const revealed = ticket.rounds.filter((r) => r.revealedAt !== null && r.stats);
  const roundCount = revealed.length;
  const how =
    ticket.resolution === 'consensus' ? 'consensus' : 'decided by the facilitator without full consensus';
  const lines = [
    `Planning Poker: ${ticket.estimate} story points agreed in ${roundCount} round${roundCount === 1 ? '' : 's'} (${how}).`,
  ];
  for (const r of revealed) {
    const votes = r.voters
      .filter((v) => r.votes[v.id] !== undefined)
      .map((v) => `${v.name} ${label(r.votes[v.id])}`)
      .join(', ');
    const spread = r.stats!.spreadSteps;
    lines.push(`Round ${r.number}: ${votes || 'no votes'}${spread === null ? '' : ` (spread ${spread} step${spread === 1 ? '' : 's'})`}`);
  }
  return { estimate: ticket.estimate, roundCount, resolution: ticket.resolution, lines };
}
