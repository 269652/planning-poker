import { createHash } from 'node:crypto';
import { SYSTEM, RoomError, applyAction, createRoom, type Action, type RoomState, type Ticket } from '@/core/room';
import { summarizeTicket } from '@/core/summary';
import { viewFor } from '@/core/view';
import type { JiraGateway } from '@/jira/gateway';
import { clientMessage, type ClientMessage, type ServerMessage } from './protocol';

/** Anything we can push a text frame to (a websocket, or a fake in tests). */
export interface Connection {
  send(data: string): void;
}

interface Room {
  state: RoomState;
  conns: Map<Connection, string>;
  version: number;
  lastActivity: number;
  writing: Set<string>;
}

export interface RoomManagerOptions {
  gateway?: JiraGateway | null;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

/** Public participant id: a one-way hash of the secret client key, scoped to the room. */
export function participantId(roomId: string, clientKey: string): string {
  return createHash('sha256').update(`${roomId}:${clientKey}`).digest('hex').slice(0, 16);
}

/**
 * Owns all rooms. Transport-agnostic: feed it raw frames via `handleMessage`
 * and it pushes JSON frames to the registered `Connection`s. All planning rules
 * live in the pure reducer (core/room); this class adds identity, fan-out,
 * per-client projection and Jira orchestration.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private sessions = new Map<Connection, { roomId: string; pid: string }>();
  private gateway: JiraGateway | null;
  private now: () => number;
  private log: (msg: string, err?: unknown) => void;

  constructor(opts: RoomManagerOptions = {}) {
    this.gateway = opts.gateway ?? null;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m, e) => console.error(m, e ?? ''));
  }

  get roomCount() {
    return this.rooms.size;
  }

  async handleMessage(conn: Connection, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      const parsed = clientMessage.safeParse(JSON.parse(raw));
      if (!parsed.success) return this.send(conn, { type: 'error', code: 'bad_request', message: 'Invalid message' });
      msg = parsed.data;
    } catch {
      return this.send(conn, { type: 'error', code: 'bad_request', message: 'Invalid JSON' });
    }

    try {
      if (msg.type === 'ping') return this.send(conn, { type: 'pong' });
      if (msg.type === 'join') return this.join(conn, msg);

      const session = this.sessions.get(conn);
      const room = session && this.rooms.get(session.roomId);
      if (!session || !room) return this.send(conn, { type: 'error', code: 'not_joined', message: 'Join a room first' });
      room.lastActivity = this.now();

      if (msg.type === 'action') return await this.handleAction(conn, room, session.pid, msg.action as Action);
      return await this.handleJira(conn, room, session.pid, msg);
    } catch (e) {
      if (e instanceof RoomError) return this.send(conn, { type: 'error', code: e.code, message: e.message });
      this.log('Unhandled error in handleMessage', e);
      this.send(conn, { type: 'error', code: 'internal', message: 'Internal error' });
    }
  }

  disconnect(conn: Connection): void {
    const session = this.sessions.get(conn);
    if (!session) return;
    this.sessions.delete(conn);
    const room = this.rooms.get(session.roomId);
    if (!room) return;
    room.conns.delete(conn);
    room.lastActivity = this.now();
    const stillThere = [...room.conns.values()].includes(session.pid);
    if (!stillThere) {
      room.state = applyAction(room.state, session.pid, { type: 'disconnect' }, this.now());
      this.broadcast(room);
    }
  }

  /** Drop rooms with nobody connected for longer than `maxIdleMs`. Returns how many were removed. */
  sweep(maxIdleMs: number): number {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.conns.size === 0 && this.now() - room.lastActivity > maxIdleMs) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // ---------------------------------------------------------------- handlers

  private join(conn: Connection, msg: Extract<ClientMessage, { type: 'join' }>) {
    this.disconnect(conn); // switching rooms on the same socket
    const pid = participantId(msg.roomId, msg.clientKey);
    let room = this.rooms.get(msg.roomId);
    const isNew = !room;
    room ??= {
      state: createRoom(msg.roomId, (msg.roomName ?? '').trim() || msg.roomId, this.now()),
      conns: new Map(),
      version: 0,
      lastActivity: this.now(),
      writing: new Set(),
    };
    try {
      room.state = applyAction(room.state, pid, { type: 'join', name: msg.name, role: msg.role }, this.now());
    } catch (e) {
      if (e instanceof RoomError) return this.send(conn, { type: 'error', code: e.code, message: e.message });
      throw e;
    }
    if (isNew) this.rooms.set(msg.roomId, room);
    room.conns.set(conn, pid);
    room.lastActivity = this.now();
    this.sessions.set(conn, { roomId: msg.roomId, pid });
    this.broadcast(room);
  }

  private async handleAction(conn: Connection, room: Room, pid: string, action: Action) {
    const ticketBefore = room.state.currentTicketId;
    // Tickets created by clients are always manual: only the Jira import creates `jira` tickets,
    // so a client can never aim a write-back at an arbitrary issue.
    const next =
      action.type === 'addTicket'
        ? { ...action, ticket: { title: action.ticket.title, key: action.ticket.key, description: action.ticket.description, source: 'manual' as const } }
        : action;
    room.state = applyAction(room.state, pid, next, this.now());
    this.broadcast(room);
    if (action.type === 'accept' && room.state.settings.writeBack === 'auto' && ticketBefore) {
      await this.writeBack(room, ticketBefore);
    }
  }

  private async handleJira(conn: Connection, room: Room, pid: string, msg: Extract<ClientMessage, { type: 'jira' }>) {
    const reply = (ok: boolean, data?: unknown, error?: string) =>
      this.send(conn, { type: 'jiraResult', reqId: msg.reqId, ok, ...(ok ? { data } : { error }) });
    const gw = this.gateway;

    if (msg.op === 'status') {
      return reply(true, { enabled: !!gw, mode: gw?.mode ?? null, writeBack: room.state.settings.writeBack });
    }
    if (!gw) return reply(false, undefined, 'Jira is not configured on this server');
    if (room.state.hostId !== pid) return reply(false, undefined, 'Only the host can use Jira');

    try {
      switch (msg.op) {
        case 'boards':
          return reply(true, await gw.listBoards(msg.query));
        case 'sprints':
          return reply(true, await gw.listSprints(msg.boardId));
        case 'import': {
          const tickets = await gw.fetchIssues({ boardId: msg.boardId, sprintId: msg.sprintId, jql: msg.jql });
          room.state = applyAction(room.state, pid, { type: 'importTickets', tickets }, this.now());
          this.broadcast(room);
          return reply(true, { count: tickets.length });
        }
        case 'writeBack': {
          const err = await this.writeBack(room, msg.ticketId);
          return err ? reply(false, undefined, err) : reply(true, {});
        }
      }
    } catch (e) {
      reply(false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Write an agreed ticket's estimate + round summary to Jira, tracking
   * pending/written/failed in room state. Returns an error string for callers
   * that want to report it (the outcome is always recorded in state too).
   */
  private async writeBack(room: Room, ticketId: string): Promise<string | null> {
    const gw = this.gateway;
    const find = (): Ticket | undefined => room.state.tickets.find((t) => t.id === ticketId);
    const t = find();
    if (!gw) return 'Jira is not configured on this server';
    if (!t || t.source !== 'jira' || !t.key) return 'Ticket is not a Jira ticket';
    if (t.status !== 'agreed' || t.estimate === null) return 'Ticket has no agreed estimate';
    if (room.writing.has(ticketId)) return 'A write-back is already in progress';

    room.writing.add(ticketId);
    const { key, estimate } = t;
    try {
      const lines = summarizeTicket(t).lines;
      room.state = applyAction(room.state, SYSTEM, { type: 'jiraWriteStart', ticketId }, this.now());
      this.broadcast(room);
      let error: string | null = null;
      try {
        await gw.writeEstimate(key, estimate, lines);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const after = find();
      // Ignore the outcome if the ticket was reopened or re-decided while we were writing.
      if (after && after.status === 'agreed' && after.estimate === estimate) {
        room.state = applyAction(room.state, SYSTEM, { type: 'jiraWriteResult', ticketId, ok: !error, error: error ?? undefined }, this.now());
        this.broadcast(room);
      }
      return error;
    } finally {
      room.writing.delete(ticketId);
    }
  }

  // ---------------------------------------------------------------- output

  private broadcast(room: Room) {
    room.version++;
    for (const [conn, pid] of room.conns) {
      this.send(conn, { type: 'state', version: room.version, view: viewFor(room.state, pid) });
    }
  }

  private send(conn: Connection, msg: ServerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch (e) {
      this.log('send failed', e);
    }
  }
}
