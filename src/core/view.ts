import { analyzeConvergence, type Convergence } from './convergence';
import type { Card } from './deck';
import type { Role, Round, RoomState, Settings, Ticket } from './room';
import type { RoundStats } from './stats';

/**
 * Per-client projection of the room. This is the ONLY shape that leaves the
 * server: hidden votes (unrevealed rounds) are stripped here, so a client can
 * never learn another participant's card before the reveal.
 */

export interface ParticipantView {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  hasVoted: boolean;
  /** Visible only after reveal, or to the participant themself. */
  vote: Card | null;
}

export interface RoundView {
  number: number;
  startedAt: number;
  revealedAt: number | null;
  votes: Record<string, Card> | null;
  voters: { id: string; name: string }[] | null;
  stats: RoundStats | null;
}

export interface TicketView extends Omit<Ticket, 'rounds'> {
  rounds: RoundView[];
  convergence: Convergence;
}

export interface RoomView {
  id: string;
  name: string;
  you: string;
  hostId: string | null;
  settings: Settings;
  participants: ParticipantView[];
  tickets: TicketView[];
  currentTicketId: string | null;
}

export function viewFor(s: RoomState, clientId: string): RoomView {
  const current = s.tickets.find((t) => t.id === s.currentTicketId);
  const live: Round | undefined = current?.rounds[current.rounds.length - 1];

  const participants: ParticipantView[] = Object.values(s.participants).map((p) => {
    const cast = live?.votes[p.id];
    const visible = live && (live.revealedAt !== null || p.id === clientId);
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      connected: p.connected,
      hasVoted: cast !== undefined,
      vote: visible && cast !== undefined ? cast : null,
    };
  });

  return {
    id: s.id,
    name: s.name,
    you: clientId,
    hostId: s.hostId,
    settings: s.settings,
    participants,
    tickets: s.tickets.map(ticketView),
    currentTicketId: s.currentTicketId,
  };
}

function ticketView(t: Ticket): TicketView {
  const revealed = t.rounds.filter((r) => r.revealedAt !== null && r.stats);
  return {
    ...t,
    rounds: t.rounds.map(roundView),
    convergence: analyzeConvergence(revealed.map((r) => ({ number: r.number, stats: r.stats! }))),
  };
}

function roundView(r: Round): RoundView {
  const open = r.revealedAt !== null;
  return {
    number: r.number,
    startedAt: r.startedAt,
    revealedAt: r.revealedAt,
    votes: open ? r.votes : null,
    voters: open ? r.voters : null,
    stats: open ? r.stats : null,
  };
}
