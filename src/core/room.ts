import { Card, isCard, isNumericCard } from './deck';
import { RoundStats, computeRoundStats } from './stats';

/**
 * Pure room state machine. `applyAction(state, actor, action, now)` returns a new
 * state or throws a RoomError; it never mutates its input and never touches I/O,
 * time or randomness (`now` is injected, ticket ids come from a counter), so the
 * whole planning flow is deterministic and unit-testable.
 *
 * Ticket lifecycle:
 *   pending/skipped --select--> voting --reveal--> revealed --accept--> agreed
 *                                  ^------revote-------+          |
 *                                  ^---------------reopen---------+
 */

export const SYSTEM = '__system__';
export const MAX_NAME = 40;

export type Role = 'voter' | 'observer';
export type TicketStatus = 'pending' | 'voting' | 'revealed' | 'agreed' | 'skipped';
export type Resolution = 'consensus' | 'forced';
export type WriteStatus = 'none' | 'pending' | 'written' | 'failed';
export type ErrorCode = 'invalid' | 'forbidden' | 'invalid_state' | 'no_consensus' | 'not_found';

export class RoomError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Participant {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
}

export interface Round {
  number: number;
  startedAt: number;
  revealedAt: number | null;
  votes: Record<string, Card>;
  /** Eligible voters at reveal time; empty until revealed. */
  voters: { id: string; name: string }[];
  stats: RoundStats | null;
}

export interface Ticket {
  id: string;
  key: string | null;
  title: string;
  description: string;
  url: string | null;
  source: 'jira' | 'manual';
  /** Estimate that exists in Jira before planning (informational). */
  currentEstimate: number | null;
  status: TicketStatus;
  rounds: Round[];
  estimate: number | null;
  resolution: Resolution | null;
  agreedAt: number | null;
  jira: { writeStatus: WriteStatus; error: string | null; writtenAt: number | null };
}

export interface Settings {
  /** Reveal automatically as soon as every eligible voter has voted. */
  autoReveal: boolean;
  /** `auto`: write agreed estimates to Jira immediately; `manual`: host clicks. */
  writeBack: 'auto' | 'manual';
}

export interface RoomState {
  id: string;
  name: string;
  createdAt: number;
  hostId: string | null;
  participants: Record<string, Participant>;
  tickets: Ticket[];
  currentTicketId: string | null;
  ticketSeq: number;
  settings: Settings;
}

export interface TicketInput {
  key?: string | null;
  title: string;
  description?: string;
  url?: string | null;
  source?: 'jira' | 'manual';
  currentEstimate?: number | null;
}

export type Action =
  | { type: 'join'; name: string; role?: Role }
  | { type: 'disconnect' }
  | { type: 'rename'; name: string }
  | { type: 'setRole'; role: Role; target?: string }
  | { type: 'transferHost'; to: string }
  | { type: 'setSettings'; autoReveal?: boolean; writeBack?: 'auto' | 'manual' }
  | { type: 'addTicket'; ticket: TicketInput }
  | { type: 'importTickets'; tickets: TicketInput[] }
  | { type: 'removeTicket'; ticketId: string }
  | { type: 'selectTicket'; ticketId: string }
  | { type: 'vote'; card: Card }
  | { type: 'retract' }
  | { type: 'reveal' }
  | { type: 'revote' }
  | { type: 'accept'; value?: number }
  | { type: 'skip' }
  | { type: 'reopen'; ticketId: string }
  // Internal, only accepted from SYSTEM:
  | { type: 'jiraWriteStart'; ticketId: string }
  | { type: 'jiraWriteResult'; ticketId: string; ok: boolean; error?: string };

export function createRoom(id: string, name: string, now: number): RoomState {
  return {
    id,
    name,
    createdAt: now,
    hostId: null,
    participants: {},
    tickets: [],
    currentTicketId: null,
    ticketSeq: 0,
    settings: { autoReveal: false, writeBack: 'auto' },
  };
}

export function applyAction(prev: RoomState, actor: string, action: Action, now: number): RoomState {
  const s = structuredClone(prev);
  switch (action.type) {
    case 'join':
      return join(s, actor, action.name, action.role);
    case 'disconnect':
      if (s.participants[actor]) s.participants[actor].connected = false;
      return maybeAutoReveal(s, now);
    case 'rename':
      requireParticipant(s, actor).name = cleanName(action.name);
      return s;
    case 'setRole':
      return setRole(s, actor, action.role, action.target ?? actor, now);
    case 'transferHost':
      requireHost(s, actor);
      if (!s.participants[action.to]) throw new RoomError('forbidden', 'Unknown participant');
      s.hostId = action.to;
      return s;
    case 'setSettings':
      requireHost(s, actor);
      if (action.autoReveal !== undefined) s.settings.autoReveal = !!action.autoReveal;
      if (action.writeBack !== undefined) {
        if (action.writeBack !== 'auto' && action.writeBack !== 'manual') throw new RoomError('invalid', 'Bad writeBack');
        s.settings.writeBack = action.writeBack;
      }
      return maybeAutoReveal(s, now);
    case 'addTicket':
      requireHost(s, actor);
      addTicket(s, action.ticket);
      return s;
    case 'importTickets':
      requireHost(s, actor);
      for (const t of action.tickets) upsertTicket(s, t);
      return s;
    case 'removeTicket':
      requireHost(s, actor);
      findTicket(s, action.ticketId);
      s.tickets = s.tickets.filter((t) => t.id !== action.ticketId);
      if (s.currentTicketId === action.ticketId) s.currentTicketId = null;
      return s;
    case 'selectTicket':
      requireHost(s, actor);
      return selectTicket(s, action.ticketId, now);
    case 'vote':
      return vote(s, actor, action.card, now);
    case 'retract': {
      const { round } = currentRound(s, 'voting');
      delete round.votes[actor];
      return s;
    }
    case 'reveal':
      requireHost(s, actor);
      return reveal(s, now);
    case 'revote':
      requireHost(s, actor);
      return revote(s, now);
    case 'accept':
      requireHost(s, actor);
      return accept(s, action.value, now);
    case 'skip': {
      requireHost(s, actor);
      const t = requireCurrent(s);
      if (t.status === 'agreed') throw new RoomError('invalid_state', 'Ticket already agreed');
      t.status = 'skipped';
      s.currentTicketId = null;
      return s;
    }
    case 'reopen': {
      requireHost(s, actor);
      const t = findTicket(s, action.ticketId);
      if (t.status !== 'agreed') throw new RoomError('invalid_state', 'Only agreed tickets can be reopened');
      t.status = 'voting';
      t.estimate = null;
      t.resolution = null;
      t.agreedAt = null;
      t.jira = { writeStatus: 'none', error: null, writtenAt: null };
      t.rounds.push(newRound(t.rounds.length + 1, now));
      s.currentTicketId = t.id;
      return s;
    }
    case 'jiraWriteStart': {
      requireSystem(actor);
      findTicket(s, action.ticketId).jira = { writeStatus: 'pending', error: null, writtenAt: null };
      return s;
    }
    case 'jiraWriteResult': {
      requireSystem(actor);
      const t = findTicket(s, action.ticketId);
      t.jira = action.ok
        ? { writeStatus: 'written', error: null, writtenAt: now }
        : { writeStatus: 'failed', error: action.error ?? 'Unknown error', writtenAt: null };
      return s;
    }
    default: {
      const never: never = action;
      throw new RoomError('invalid', `Unknown action ${(never as { type?: string }).type}`);
    }
  }
}

/** Voters whose vote a round is waiting for. */
export function eligibleVoters(s: RoomState, round: Round | null): Participant[] {
  return Object.values(s.participants).filter(
    (p) => p.role === 'voter' && (p.connected || (round !== null && round.votes[p.id] !== undefined)),
  );
}

// ---------------------------------------------------------------- internals

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME) : '';
  if (!name) throw new RoomError('invalid', 'Name must not be empty');
  return name;
}

function join(s: RoomState, id: string, rawName: string, role?: Role): RoomState {
  if (!id) throw new RoomError('invalid', 'Missing client id');
  const name = cleanName(rawName);
  if (role !== undefined && role !== 'voter' && role !== 'observer') throw new RoomError('invalid', 'Bad role');
  const existing = s.participants[id];
  if (existing) {
    existing.name = name;
    existing.connected = true;
  } else {
    s.participants[id] = { id, name, role: role ?? 'voter', connected: true };
  }
  if (!s.hostId) s.hostId = id;
  return s;
}

function setRole(s: RoomState, actor: string, role: Role, target: string, now: number): RoomState {
  if (role !== 'voter' && role !== 'observer') throw new RoomError('invalid', 'Bad role');
  requireParticipant(s, actor);
  if (target !== actor) requireHost(s, actor);
  const p = s.participants[target];
  if (!p) throw new RoomError('not_found', 'Unknown participant');
  p.role = role;
  if (role === 'observer') {
    const t = s.tickets.find((x) => x.id === s.currentTicketId);
    const r = t?.rounds[t.rounds.length - 1];
    if (t && r && r.revealedAt === null) delete r.votes[target];
  }
  return maybeAutoReveal(s, now);
}

function requireParticipant(s: RoomState, id: string): Participant {
  const p = s.participants[id];
  if (!p) throw new RoomError('forbidden', 'Join the room first');
  return p;
}
function requireHost(s: RoomState, id: string) {
  if (s.hostId !== id) throw new RoomError('forbidden', 'Only the host can do that');
}
function requireSystem(id: string) {
  if (id !== SYSTEM) throw new RoomError('forbidden', 'Internal action');
}
function findTicket(s: RoomState, id: string): Ticket {
  const t = s.tickets.find((x) => x.id === id);
  if (!t) throw new RoomError('not_found', 'Unknown ticket');
  return t;
}
function requireCurrent(s: RoomState): Ticket {
  const t = s.tickets.find((x) => x.id === s.currentTicketId);
  if (!t) throw new RoomError('invalid_state', 'No ticket is being estimated');
  return t;
}
function currentRound(s: RoomState, expect: 'voting' | 'revealed'): { ticket: Ticket; round: Round } {
  const ticket = requireCurrent(s);
  if (ticket.status !== expect) {
    throw new RoomError('invalid_state', expect === 'voting' ? 'Voting is not open' : 'Round is not revealed');
  }
  return { ticket, round: ticket.rounds[ticket.rounds.length - 1] };
}

function newRound(number: number, now: number): Round {
  return { number, startedAt: now, revealedAt: null, votes: {}, voters: [], stats: null };
}

function makeTicket(s: RoomState, input: TicketInput): Ticket {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new RoomError('invalid', 'Ticket title must not be empty');
  const n = ++s.ticketSeq;
  return {
    id: `t${n}`,
    key: input.key ?? null,
    title: title.slice(0, 300),
    description: (input.description ?? '').slice(0, 8000),
    url: input.url ?? null,
    source: input.source ?? 'manual',
    currentEstimate: input.currentEstimate ?? null,
    status: 'pending',
    rounds: [],
    estimate: null,
    resolution: null,
    agreedAt: null,
    jira: { writeStatus: 'none', error: null, writtenAt: null },
  };
}

function addTicket(s: RoomState, input: TicketInput) {
  s.tickets.push(makeTicket(s, input));
}

function upsertTicket(s: RoomState, input: TicketInput) {
  const existing = input.key ? s.tickets.find((t) => t.key === input.key) : undefined;
  if (!existing) return addTicket(s, input);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title) existing.title = title.slice(0, 300);
  if (input.description !== undefined) existing.description = input.description.slice(0, 8000);
  if (input.url !== undefined) existing.url = input.url;
  if (input.currentEstimate !== undefined) existing.currentEstimate = input.currentEstimate;
}

function selectTicket(s: RoomState, ticketId: string, now: number): RoomState {
  const t = findTicket(s, ticketId);
  if (t.status === 'agreed') throw new RoomError('invalid_state', 'Ticket is already agreed; reopen it to re-estimate');
  if (t.status === 'pending' || t.status === 'skipped') {
    t.status = 'voting';
    const last = t.rounds[t.rounds.length - 1];
    if (!last || last.revealedAt !== null) t.rounds.push(newRound(t.rounds.length + 1, now));
  }
  s.currentTicketId = t.id;
  return s;
}

function vote(s: RoomState, actor: string, card: Card, now: number): RoomState {
  const p = requireParticipant(s, actor);
  const { round } = currentRound(s, 'voting');
  if (!isCard(card)) throw new RoomError('invalid', 'Not a valid card');
  if (p.role !== 'voter') throw new RoomError('forbidden', 'Observers cannot vote');
  round.votes[actor] = card;
  return maybeAutoReveal(s, now);
}

function maybeAutoReveal(s: RoomState, now: number): RoomState {
  if (!s.settings.autoReveal) return s;
  const t = s.tickets.find((x) => x.id === s.currentTicketId);
  if (!t || t.status !== 'voting') return s;
  const round = t.rounds[t.rounds.length - 1];
  if (Object.keys(round.votes).length === 0) return s;
  const eligible = eligibleVoters(s, round);
  if (eligible.length > 0 && eligible.every((p) => round.votes[p.id] !== undefined)) doReveal(s, t, now);
  return s;
}

function reveal(s: RoomState, now: number): RoomState {
  const { ticket, round } = currentRound(s, 'voting');
  if (Object.keys(round.votes).length === 0) throw new RoomError('invalid_state', 'Nobody has voted yet');
  doReveal(s, ticket, now);
  return s;
}

function doReveal(s: RoomState, t: Ticket, now: number) {
  const round = t.rounds[t.rounds.length - 1];
  const eligible = eligibleVoters(s, round);
  round.voters = eligible.map((p) => ({ id: p.id, name: p.name }));
  round.stats = computeRoundStats(round.votes, eligible.length);
  round.revealedAt = now;
  t.status = 'revealed';
}

function revote(s: RoomState, now: number): RoomState {
  const t = requireCurrent(s);
  if (t.status === 'voting') {
    t.rounds[t.rounds.length - 1].votes = {};
  } else if (t.status === 'revealed') {
    t.status = 'voting';
    t.rounds.push(newRound(t.rounds.length + 1, now));
  } else {
    throw new RoomError('invalid_state', 'Nothing to revote');
  }
  return s;
}

function accept(s: RoomState, value: number | undefined, now: number): RoomState {
  const { ticket, round } = currentRound(s, 'revealed');
  if (value !== undefined && !isNumericCard(value)) throw new RoomError('invalid', 'Estimate must be a numeric card');
  const stats = round.stats!;
  if (stats.consensus) {
    if (value !== undefined && value !== stats.consensusValue) {
      throw new RoomError('invalid', `Round reached consensus on ${stats.consensusValue}`);
    }
    ticket.estimate = stats.consensusValue;
    ticket.resolution = 'consensus';
  } else {
    if (value === undefined) throw new RoomError('no_consensus', 'No consensus; pick a value to force');
    ticket.estimate = value;
    ticket.resolution = 'forced';
  }
  ticket.status = 'agreed';
  ticket.agreedAt = now;
  ticket.jira = { writeStatus: 'none', error: null, writtenAt: null };
  return s;
}
