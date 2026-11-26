import { randomUUID } from "node:crypto";
import { type Card, type NumericCard, isCard, isNumericCard } from "./deck";
import { type AgreementRule, type VoteStats, analyzeVotes } from "./stats";
import { type Convergence, analyzeConvergence } from "./convergence";

export const ERROR_CODES = [
  "FORBIDDEN", "NO_TICKET", "BAD_PHASE", "INVALID", "NO_VOTES",
  "NO_AGREEMENT", "NOT_FOUND", "DUPLICATE", "NOT_JOINED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class RoomError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "RoomError";
  }
}

export type Role = "voter" | "observer";
export type TicketStatus = "open" | "estimated";
export type Resolution = "agreement" | "override";
export type WritebackStatus = "none" | "pending" | "synced" | "failed";

export interface Writeback {
  status: WritebackStatus;
  error?: string;
  at?: number;
}

export interface Participant {
  id: string;
  /** Secret reconnect credential. Never included in views. */
  token: string;
  name: string;
  role: Role;
  connected: boolean;
}

export interface Round {
  number: number;
  status: "voting" | "revealed";
  votes: Record<string, Card>;
  startedAt: number;
  revealedAt?: number;
  /** Rule in force when the round was revealed (history is never rewritten). */
  rule?: AgreementRule;
  stats?: VoteStats;
}

export interface Ticket {
  id: string;
  key?: string;
  title: string;
  description?: string;
  url?: string;
  source: "manual" | "jira";
  /** The estimate currently stored in Jira when the ticket was imported. */
  currentEstimate: number | null;
  status: TicketStatus;
  estimate: NumericCard | null;
  resolution: Resolution | null;
  estimatedAt?: number;
  rounds: Round[];
  writeback: Writeback;
}

export interface RoomState {
  id: string;
  name: string;
  rule: AgreementRule;
  createdAt: number;
  hostId: string | null;
  currentTicketId: string | null;
  participants: Participant[];
  tickets: Ticket[];
}

export interface NewTicket {
  title: string;
  key?: string;
  description?: string;
  url?: string;
  source?: "manual" | "jira";
  currentEstimate?: number | null;
}

// ---- Views (what a given participant may see) -------------------------------

export interface ParticipantView {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  isHost: boolean;
  /** Has voted in the current round of the current ticket. */
  hasVoted: boolean;
}

export interface RoundView {
  number: number;
  status: "voting" | "revealed";
  /** Participant ids that have cast a vote (the values stay hidden until reveal). */
  voted: string[];
  /** Participant id -> card. Only present once revealed. */
  votes: Record<string, Card> | null;
  myVote: Card | null;
  stats: VoteStats | null;
  rule: AgreementRule | null;
  startedAt: number;
  revealedAt: number | null;
}

export interface TicketView extends Omit<Ticket, "rounds"> {
  rounds: RoundView[];
  convergence: Convergence;
}

export interface RoomView {
  id: string;
  name: string;
  rule: AgreementRule;
  you: string;
  hostId: string | null;
  currentTicketId: string | null;
  participants: ParticipantView[];
  tickets: TicketView[];
}

// ---- Room -------------------------------------------------------------------

export interface RoomOptions {
  id: string;
  name: string;
  rule?: AgreementRule;
  now?: () => number;
  newId?: () => string;
}

export class Room {
  private constructor(
    private state: RoomState,
    private readonly now: () => number,
    private readonly newId: () => string,
  ) {}

  static create(opts: RoomOptions): Room {
    const now = opts.now ?? Date.now;
    const name = opts.name.trim();
    if (!name) throw new RoomError("INVALID", "Room name must not be empty");
    return new Room(
      {
        id: opts.id, name, rule: opts.rule ?? "unanimous", createdAt: now(),
        hostId: null, currentTicketId: null, participants: [], tickets: [],
      },
      now,
      opts.newId ?? randomUUID,
    );
  }

  static restore(state: RoomState, opts: { now?: () => number; newId?: () => string } = {}): Room {
    return new Room(structuredClone(state), opts.now ?? Date.now, opts.newId ?? randomUUID);
  }

  snapshot(): RoomState {
    return structuredClone(this.state);
  }

  get id(): string { return this.state.id; }
  get name(): string { return this.state.name; }
  get createdAt(): number { return this.state.createdAt; }

  /** Resolves a secret participant token to its participant id, or null. */
  authenticate(token: string | undefined): string | null {
    if (!token) return null;
    return this.state.participants.find((p) => p.token === token)?.id ?? null;
  }

  isHost(participantId: string): boolean {
    return this.state.hostId === participantId;
  }

  getTicket(id: string): Ticket | undefined {
    const t = this.state.tickets.find((x) => x.id === id);
    return t ? structuredClone(t) : undefined;
  }

  /** Full history without secrets, for export. */
  exportState(): Omit<RoomState, "participants"> & { participants: Omit<Participant, "token">[] } {
    const { participants, ...rest } = structuredClone(this.state);
    return { ...rest, participants: participants.map(({ token: _t, ...p }) => p) };
  }

  // ---- participants

  join(input: { name: string; role?: Role; token?: string }): { participant: Participant; token: string } {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new RoomError("INVALID", "Name must not be empty");
    const existing = input.token ? this.state.participants.find((p) => p.token === input.token) : undefined;
    if (existing) {
      existing.connected = true;
      existing.name = name;
      if (input.role) existing.role = input.role;
      return { participant: { ...existing }, token: existing.token };
    }
    const p: Participant = {
      id: this.newId(), token: this.newId(), name, role: input.role ?? "voter", connected: true,
    };
    this.state.participants.push(p);
    if (!this.state.hostId) this.state.hostId = p.id;
    return { participant: { ...p }, token: p.token };
  }

  leave(participantId: string): void {
    const p = this.state.participants.find((x) => x.id === participantId);
    if (p) p.connected = false;
  }

  promote(actor: string, targetId: string): void {
    this.requireHost(actor);
    if (!this.state.participants.some((p) => p.id === targetId)) throw new RoomError("NOT_FOUND", "Unknown participant");
    this.state.hostId = targetId;
  }

  setRule(actor: string, rule: AgreementRule): void {
    this.requireHost(actor);
    if (rule !== "unanimous" && rule !== "adjacent") throw new RoomError("INVALID", "Unknown agreement rule");
    this.state.rule = rule;
  }

  // ---- tickets

  addTicket(actor: string, input: NewTicket): Ticket {
    this.requireHost(actor);
    const title = input.title.trim();
    if (!title) throw new RoomError("INVALID", "Ticket title must not be empty");
    if (input.key && this.state.tickets.some((t) => t.key === input.key)) {
      throw new RoomError("DUPLICATE", `${input.key} is already on the board`);
    }
    const ticket: Ticket = {
      id: this.newId(), key: input.key, title, description: input.description, url: input.url,
      source: input.source ?? "manual", currentEstimate: input.currentEstimate ?? null,
      status: "open", estimate: null, resolution: null, rounds: [], writeback: { status: "none" },
    };
    this.state.tickets.push(ticket);
    return structuredClone(ticket);
  }

  removeTicket(actor: string, ticketId: string): void {
    this.requireHost(actor);
    this.ticket(ticketId);
    this.state.tickets = this.state.tickets.filter((t) => t.id !== ticketId);
    if (this.state.currentTicketId === ticketId) this.state.currentTicketId = null;
  }

  selectTicket(actor: string, ticketId: string): void {
    this.requireHost(actor);
    const t = this.ticket(ticketId);
    this.state.currentTicketId = t.id;
    if (t.rounds.length === 0) this.startRound(t);
  }

  reopen(actor: string, ticketId: string): void {
    this.requireHost(actor);
    const t = this.ticket(ticketId);
    t.status = "open";
    t.estimate = null;
    t.resolution = null;
    t.estimatedAt = undefined;
    t.writeback = { status: "none" };
    this.state.currentTicketId = t.id;
    this.startRound(t);
  }

  setWriteback(ticketId: string, wb: Writeback): void {
    this.ticket(ticketId).writeback = { ...wb, at: wb.at ?? this.now() };
  }

  // ---- rounds

  vote(actor: string, card: Card): void {
    const p = this.participant(actor);
    if (!isCard(card)) throw new RoomError("INVALID", "Not a card in the deck");
    if (p.role !== "voter") throw new RoomError("FORBIDDEN", "Observers cannot vote");
    const round = this.currentRound();
    if (round.status !== "voting") throw new RoomError("BAD_PHASE", "Votes are revealed; start the next round first");
    round.votes[actor] = card;
  }

  reveal(actor: string): void {
    this.requireHost(actor);
    const round = this.currentRound();
    if (round.status !== "voting") throw new RoomError("BAD_PHASE", "Round already revealed");
    const cards = Object.values(round.votes);
    if (cards.length === 0) throw new RoomError("NO_VOTES", "Nobody has voted yet");
    round.status = "revealed";
    round.revealedAt = this.now();
    round.rule = this.state.rule;
    round.stats = analyzeVotes(cards, this.state.rule);
  }

  nextRound(actor: string): void {
    this.requireHost(actor);
    const t = this.currentTicket();
    if (this.lastRound(t)?.status !== "revealed") throw new RoomError("BAD_PHASE", "Reveal the current round first");
    if (t.status === "estimated") throw new RoomError("BAD_PHASE", "Ticket is already estimated; reopen it first");
    this.startRound(t);
  }

  finalize(actor: string, value?: NumericCard): Ticket {
    this.requireHost(actor);
    const t = this.currentTicket();
    const round = this.lastRound(t);
    if (!round || round.status !== "revealed" || !round.stats) throw new RoomError("BAD_PHASE", "Reveal the round before finalizing");
    let estimate: NumericCard;
    let resolution: Resolution;
    if (value === undefined) {
      if (!round.stats.agreed || round.stats.agreedEstimate === null) {
        throw new RoomError("NO_AGREEMENT", "The team has not agreed; pick a value to override or play another round");
      }
      estimate = round.stats.agreedEstimate;
      resolution = "agreement";
    } else {
      if (!isNumericCard(value)) throw new RoomError("INVALID", "The final estimate must be a numeric card");
      estimate = value;
      resolution = round.stats.agreed && round.stats.agreedEstimate === value ? "agreement" : "override";
    }
    t.status = "estimated";
    t.estimate = estimate;
    t.resolution = resolution;
    t.estimatedAt = this.now();
    return structuredClone(t);
  }

  // ---- views

  view(forId: string): RoomView {
    const s = this.state;
    const current = s.tickets.find((t) => t.id === s.currentTicketId);
    const currentRound = current ? this.lastRound(current) : undefined;
    return {
      id: s.id, name: s.name, rule: s.rule, you: forId, hostId: s.hostId, currentTicketId: s.currentTicketId,
      participants: s.participants.map((p) => ({
        id: p.id, name: p.name, role: p.role, connected: p.connected, isHost: p.id === s.hostId,
        hasVoted: !!currentRound && p.id in currentRound.votes,
      })),
      tickets: s.tickets.map((t) => this.ticketView(t, forId)),
    };
  }

  private ticketView(t: Ticket, forId: string): TicketView {
    const revealedStats = t.rounds.filter((r) => r.status === "revealed" && r.stats).map((r) => r.stats!);
    return {
      ...t,
      rounds: t.rounds.map((r) => {
        const revealed = r.status === "revealed";
        return {
          number: r.number, status: r.status, voted: Object.keys(r.votes),
          votes: revealed ? { ...r.votes } : null,
          myVote: r.votes[forId] ?? null,
          stats: revealed ? r.stats ?? null : null,
          rule: r.rule ?? null, startedAt: r.startedAt, revealedAt: r.revealedAt ?? null,
        };
      }),
      convergence: analyzeConvergence(revealedStats),
    };
  }

  // ---- helpers

  private requireHost(actor: string): void {
    this.participant(actor);
    if (this.state.hostId !== actor) throw new RoomError("FORBIDDEN", "Only the host can do this");
  }

  private participant(id: string): Participant {
    const p = this.state.participants.find((x) => x.id === id);
    if (!p) throw new RoomError("NOT_FOUND", "Unknown participant");
    return p;
  }

  private ticket(id: string): Ticket {
    const t = this.state.tickets.find((x) => x.id === id);
    if (!t) throw new RoomError("NOT_FOUND", "Unknown ticket");
    return t;
  }

  private currentTicket(): Ticket {
    const id = this.state.currentTicketId;
    if (!id) throw new RoomError("NO_TICKET", "No ticket is being estimated");
    return this.ticket(id);
  }

  private currentRound(): Round {
    const t = this.currentTicket();
    const r = this.lastRound(t);
    if (!r) throw new RoomError("NO_TICKET", "No active round");
    return r;
  }

  private lastRound(t: Ticket): Round | undefined {
    return t.rounds[t.rounds.length - 1];
  }

  private startRound(t: Ticket): void {
    t.rounds.push({ number: t.rounds.length + 1, status: "voting", votes: {}, startedAt: this.now() });
  }
}
