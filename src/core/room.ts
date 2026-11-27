// Web Crypto: available in browsers (where rooms run now) and in Node ≥ 19.
const randomUUID = (): string => globalThis.crypto.randomUUID();
import { type Card, type NumericCard, isCard, isNumericCard } from "./deck";
import { type AgreementRule, type VoteStats, analyzeVotes } from "./stats";
import { type Convergence, analyzeConvergence } from "./convergence";

export const ERROR_CODES = [
  "FORBIDDEN", "NO_TICKET", "BAD_PHASE", "INVALID", "NO_VOTES",
  "NO_AGREEMENT", "NOT_FOUND", "DUPLICATE", "NOT_JOINED", "RATE_LIMITED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const NUDGE_COOLDOWN_MS = 10_000;
// Every room view carries the chat, and a view must fit the relay's 200 KiB message limit
// alongside the tickets: 100 × 500 characters stays well under it.
export const CHAT_MAX_LENGTH = 500;
/** The room keeps the latest messages only. */
export const CHAT_HISTORY = 100;
/** At most CHAT_BURST messages per CHAT_WINDOW_MS per person. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5_000;

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
  /** Wants to say something before the team moves on (lowered on a new round/ticket). */
  handRaised?: boolean;
  /**
   * PM / moderator, appointed by the host: may run the session (tickets, reveal, rounds, finalize)
   * and import from Jira through the host's helper.
   */
  moderator?: boolean;
}

export interface Round {
  number: number;
  status: "voting" | "revealed";
  votes: Record<string, Card>;
  /**
   * Participant id → random pattern id for the back of their card this round (created on their
   * first vote). Reveals neither the card nor who picked the same card.
   */
  patternIds?: Record<string, string>;
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
  /** Jira issue type and workflow status at import time (display only). */
  issueType?: string;
  jiraStatus?: string;
  /** The estimate currently stored in Jira when the ticket was imported. */
  currentEstimate: number | null;
  status: TicketStatus;
  estimate: NumericCard | null;
  resolution: Resolution | null;
  estimatedAt?: number;
  rounds: Round[];
  writeback: Writeback;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  /** The author's name when they wrote it (names can change). */
  name: string;
  text: string;
  at: number;
  /** An attached image, delivered separately (server message `image`); the host keeps the latest few. */
  imageId?: string;
  /** Emoji → ids of the participants who reacted with it (in reaction order). */
  reactions?: Record<string, string[]>;
}

/** The reactions offered on chat messages (as in Teams). */
export const REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "🎉"] as const;

/** The Jira board a room is bound to ("one session per project"). */
export interface RoomBoard { id: number; name: string; type: string }

export interface RoomState {
  id: string;
  name: string;
  /** Optional: rooms saved before boards existed have no such field. */
  board?: RoomBoard | null;
  rule: AgreementRule;
  createdAt: number;
  hostId: string | null;
  currentTicketId: string | null;
  participants: Participant[];
  tickets: Ticket[];
  /** Optional: rooms saved before chat existed have no such field. */
  chat?: ChatMessage[];
}

export interface NewTicket {
  title: string;
  key?: string;
  description?: string;
  url?: string;
  source?: "manual" | "jira";
  issueType?: string;
  jiraStatus?: string;
  currentEstimate?: number | null;
}

// ---- Views (what a given participant may see) -------------------------------

export interface ParticipantView {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  isHost: boolean;
  /** PM: may moderate the session and import from Jira (appointed by the host). */
  isModerator: boolean;
  /** Has voted in the current round of the current ticket. */
  hasVoted: boolean;
  handRaised: boolean;
}

export interface RoundView {
  number: number;
  status: "voting" | "revealed";
  /** Participant ids that have cast a vote (the values stay hidden until reveal). */
  voted: string[];
  /** Participant id -> card. Only present once revealed. */
  votes: Record<string, Card> | null;
  myVote: Card | null;
  /** Participant id → pattern id of their card (equal cards ⇒ equal ids; the card stays hidden). */
  patterns: Record<string, string>;
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
  board: RoomBoard | null;
  rule: AgreementRule;
  you: string;
  hostId: string | null;
  currentTicketId: string | null;
  participants: ParticipantView[];
  tickets: TicketView[];
  /** Oldest first. */
  chat: ChatMessage[];
}

/** What the landing page shows about a room the viewer belongs to. */
export interface RoomSummary {
  id: string;
  name: string;
  board: RoomBoard | null;
  isHost: boolean;
  ticketCount: number;
  estimatedCount: number;
  online: number;
  participantCount: number;
  current: { key: string | null; title: string } | null;
  createdAt: number;
  lastActivityAt: number;
}

// ---- Room -------------------------------------------------------------------

export interface RoomOptions {
  id: string;
  name: string;
  board?: RoomBoard | null;
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
        id: opts.id, name, board: opts.board ? { ...opts.board } : null, rule: opts.rule ?? "unanimous", createdAt: now(),
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
  get board(): RoomBoard | null { return this.state.board ? { ...this.state.board } : null; }

  /** Resolves a secret participant token to its participant id, or null. */
  authenticate(token: string | undefined): string | null {
    if (!token) return null;
    return this.state.participants.find((p) => p.token === token)?.id ?? null;
  }

  isHost(participantId: string): boolean {
    return this.state.hostId === participantId;
  }

  /** A participant's name (cheap: for messages relayed many times a second). */
  nameOf(participantId: string): string {
    return this.state.participants.find((p) => p.id === participantId)?.name ?? "Someone";
  }

  /** Host or PM: may run the session. */
  canModerate(participantId: string): boolean {
    return this.isHost(participantId) || !!this.state.participants.find((p) => p.id === participantId)?.moderator;
  }

  /** The host appoints (or removes) a PM. */
  setModerator(actor: string, targetId: string, on: boolean): void {
    this.requireHost(actor);
    const t = this.participant(targetId);
    if (t.id === this.state.hostId) throw new RoomError("INVALID", "The host can always moderate");
    t.moderator = on;
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

  /** The participant left (closed the tab, or went silent). Returns whether anything changed. */
  leave(participantId: string): boolean {
    const p = this.state.participants.find((x) => x.id === participantId);
    if (!p || !p.connected) return false;
    p.connected = false;
    p.handRaised = false;
    return true;
  }

  /** A participant who had left is back on an existing connection. Returns whether anything changed. */
  rejoin(participantId: string): boolean {
    const p = this.state.participants.find((x) => x.id === participantId);
    if (!p || p.connected) return false;
    p.connected = true;
    return true;
  }

  setRule(actor: string, rule: AgreementRule): void {
    this.requireHost(actor);
    if (rule !== "unanimous" && rule !== "adjacent") throw new RoomError("INVALID", "Unknown agreement rule");
    this.state.rule = rule;
  }

  // ---- tickets

  addTicket(actor: string, input: NewTicket): Ticket {
    this.requireModerator(actor);
    const title = input.title.trim();
    if (!title) throw new RoomError("INVALID", "Ticket title must not be empty");
    if (input.key && this.state.tickets.some((t) => t.key === input.key)) {
      throw new RoomError("DUPLICATE", `${input.key} is already on the board`);
    }
    const ticket: Ticket = {
      id: this.newId(), key: input.key, title, description: input.description, url: input.url,
      source: input.source ?? "manual", currentEstimate: input.currentEstimate ?? null,
      ...(input.issueType ? { issueType: input.issueType } : {}),
      ...(input.jiraStatus ? { jiraStatus: input.jiraStatus } : {}),
      status: "open", estimate: null, resolution: null, rounds: [], writeback: { status: "none" },
    };
    this.state.tickets.push(ticket);
    return structuredClone(ticket);
  }

  removeTicket(actor: string, ticketId: string): void {
    this.requireModerator(actor);
    this.ticket(ticketId);
    this.state.tickets = this.state.tickets.filter((t) => t.id !== ticketId);
    if (this.state.currentTicketId === ticketId) this.state.currentTicketId = null;
  }

  selectTicket(actor: string, ticketId: string): void {
    this.requireModerator(actor);
    const t = this.ticket(ticketId);
    if (this.state.currentTicketId !== t.id) this.lowerHands();
    this.state.currentTicketId = t.id;
    if (t.rounds.length === 0) this.startRound(t);
  }

  /**
   * Moves to the next open ticket after the current one in list order (wrapping around), so a
   * session can work through its queue one ticket after another. Skipping an open ticket is allowed.
   */
  nextTicket(actor: string): void {
    this.requireModerator(actor);
    const list = this.state.tickets;
    const at = list.findIndex((t) => t.id === this.state.currentTicketId);
    const order = at < 0 ? list : [...list.slice(at + 1), ...list.slice(0, at)];
    const next = order.find((t) => t.status === "open");
    if (!next) throw new RoomError("NO_TICKET", "No other open ticket — add or import more, or re-estimate one");
    this.lowerHands();
    this.state.currentTicketId = next.id;
    if (next.rounds.length === 0) this.startRound(next);
  }

  reopen(actor: string, ticketId: string): void {
    this.requireModerator(actor);
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
    // Each voter gets their own random back for the round (kept when they change their card), so
    // the backs on the table show who has voted, but nothing about who picked the same card.
    round.patternIds ??= {};
    round.patternIds[actor] ??= this.newId();
  }

  raiseHand(actor: string, raised: boolean): void {
    this.participant(actor).handRaised = raised;
  }

  /** When each participant last pinged (in memory only; a ping is a moment, not room state). */
  private readonly lastNudge = new Map<string, number>();

  /**
   * Pings connected voters who haven't voted in the open round — everyone, or one participant.
   * Anyone may ping, at most once every 10 s. Returns who should be notified.
   */
  nudge(actor: string, targetId?: string): { from: string; targets: string[] } {
    const me = this.participant(actor);
    const round = this.currentRound();
    if (round.status !== "voting") throw new RoomError("BAD_PHASE", "Votes are already revealed");
    const now = this.now();
    const last = this.lastNudge.get(actor);
    if (last !== undefined && now - last < NUDGE_COOLDOWN_MS) throw new RoomError("RATE_LIMITED", "You can ping again in a few seconds");
    const waiting = (p: Participant) => p.role === "voter" && p.connected && !(p.id in round.votes) && p.id !== actor;
    let targets: string[];
    if (targetId) {
      const t = this.participant(targetId);
      if (!waiting(t)) throw new RoomError("INVALID", `${t.name} has nothing to vote on right now`);
      targets = [t.id];
    } else {
      targets = this.state.participants.filter(waiting).map((p) => p.id);
      if (targets.length === 0) throw new RoomError("INVALID", "Everyone who can vote has voted");
    }
    this.lastNudge.set(actor, now);
    return { from: me.name, targets };
  }

  /** Recent chat send times per participant (in memory only), for the rate limit. */
  private readonly chatTimes = new Map<string, number[]>();

  /** Anyone in the room (voter or observer) may chat; a light rate limit keeps it from flooding. */
  chat(actor: string, text: string, imageId?: string): ChatMessage {
    const me = this.participant(actor);
    const clean = text.replace(/\s+$/g, "").replace(/^\s+/g, "");
    if (!clean && !imageId) throw new RoomError("INVALID", "Message must not be empty");
    if (clean.length > CHAT_MAX_LENGTH) throw new RoomError("INVALID", `Messages can be at most ${CHAT_MAX_LENGTH} characters`);
    const now = this.now();
    const recent = (this.chatTimes.get(actor) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) throw new RoomError("RATE_LIMITED", "Slow down a little — you can send again in a few seconds");
    this.chatTimes.set(actor, [...recent, now]);
    const msg: ChatMessage = { id: this.newId(), authorId: me.id, name: me.name, text: clean, at: now, ...(imageId ? { imageId } : {}) };
    const chat = (this.state.chat ??= []);
    chat.push(msg);
    if (chat.length > CHAT_HISTORY) chat.splice(0, chat.length - CHAT_HISTORY);
    return { ...msg };
  }

  /** Toggles the actor's reaction on a chat message. */
  react(actor: string, messageId: string, emoji: string): void {
    this.participant(actor);
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new RoomError("INVALID", "Unknown reaction");
    const msg = this.state.chat?.find((m) => m.id === messageId);
    if (!msg) throw new RoomError("NOT_FOUND", "That message is no longer in the chat");
    const reactions = (msg.reactions ??= {});
    const who = reactions[emoji] ?? [];
    reactions[emoji] = who.includes(actor) ? who.filter((p) => p !== actor) : [...who, actor];
    if (reactions[emoji].length === 0) delete reactions[emoji];
  }

  reveal(actor: string): void {
    this.requireModerator(actor);
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
    this.requireModerator(actor);
    const t = this.currentTicket();
    if (this.lastRound(t)?.status !== "revealed") throw new RoomError("BAD_PHASE", "Reveal the current round first");
    if (t.status === "estimated") throw new RoomError("BAD_PHASE", "Ticket is already estimated; reopen it first");
    this.startRound(t);
  }

  finalize(actor: string, value?: NumericCard): Ticket {
    this.requireModerator(actor);
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
      id: s.id, name: s.name, board: s.board ?? null, rule: s.rule, you: forId, hostId: s.hostId, currentTicketId: s.currentTicketId,
      participants: s.participants.map((p) => ({
        id: p.id, name: p.name, role: p.role, connected: p.connected, isHost: p.id === s.hostId, isModerator: !!p.moderator,
        hasVoted: !!currentRound && p.id in currentRound.votes, handRaised: !!p.handRaised,
      })),
      tickets: s.tickets.map((t) => this.ticketView(t, forId)),
      chat: (s.chat ?? []).map((m) => structuredClone(m)),
    };
  }

  summary(forId: string): RoomSummary {
    const s = this.state;
    const current = s.tickets.find((t) => t.id === s.currentTicketId);
    const times = [s.createdAt];
    for (const t of s.tickets) {
      if (t.estimatedAt) times.push(t.estimatedAt);
      for (const r of t.rounds) times.push(r.startedAt, r.revealedAt ?? 0);
    }
    return {
      id: s.id, name: s.name, board: s.board ?? null, isHost: s.hostId === forId,
      ticketCount: s.tickets.length, estimatedCount: s.tickets.filter((t) => t.status === "estimated").length,
      online: s.participants.filter((p) => p.connected).length, participantCount: s.participants.length,
      current: current ? { key: current.key ?? null, title: current.title } : null,
      createdAt: s.createdAt, lastActivityAt: Math.max(...times),
    };
  }

  private ticketView(t: Ticket, forId: string): TicketView {
    const revealedStats = t.rounds.filter((r) => r.status === "revealed" && r.stats).map((r) => r.stats!);
    return {
      ...t,
      rounds: t.rounds.map((r) => {
        const revealed = r.status === "revealed";
        const patterns: Record<string, string> = {};
        // Keyed by voter. (Rounds saved by older versions keyed them by card value, which would
        // reveal equal cards — those are simply not shown.)
        for (const pid of Object.keys(r.votes)) {
          const id = r.patternIds?.[pid];
          if (id) patterns[pid] = id;
        }
        return {
          number: r.number, status: r.status, voted: Object.keys(r.votes),
          votes: revealed ? { ...r.votes } : null,
          myVote: r.votes[forId] ?? null,
          patterns,
          stats: revealed ? r.stats ?? null : null,
          rule: r.rule ?? null, startedAt: r.startedAt, revealedAt: r.revealedAt ?? null,
        };
      }),
      convergence: analyzeConvergence(revealedStats),
    };
  }

  // ---- helpers

  private requireModerator(actor: string): void {
    this.participant(actor);
    if (!this.canModerate(actor)) throw new RoomError("FORBIDDEN", "Only the host or a PM can do this");
  }

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
    t.rounds.push({ number: t.rounds.length + 1, status: "voting", votes: {}, patternIds: {}, startedAt: this.now() });
    this.lowerHands();
  }

  private lowerHands(): void {
    for (const p of this.state.participants) p.handRaised = false;
  }
}
