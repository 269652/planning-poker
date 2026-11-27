import { RoomError, type Room, type RoomView } from "@/core/room";
import { MAX_DESCRIPTION_CHARS, ProtocolError, parseClientMessage, type ClientMessage, type ServerMessage, type StreamList } from "@/core/protocol";
import { formatEstimateComment } from "@/jira/comment";
import { JiraError } from "@/jira/client";
import type { JiraGateway, ListIssuesOptions } from "@/jira/types";

/** One participant's connection to the host (a guest via the relay, or the host's own tab). */
export interface PeerLink {
  /** Handles one raw message from the participant. Resolves once it is fully processed (incl. Jira calls). */
  receive(raw: string): Promise<void>;
  /** The connection is gone. */
  close(): void;
}

export interface HostEngineOptions {
  room: Room;
  jira: JiraGateway | null;
  /** Called after every change, so the host can persist the room. */
  onChange?: (room: Room) => void;
  /** Clock (tests). */
  now?: () => number;
}

interface Conn {
  send: (m: ServerMessage) => void;
  pid: string | null;
  /** Last message from this connection (ms). */
  lastSeen: number;
  /** The client sends heartbeats (pings), so silence means it's gone. Older clients don't. */
  heartbeat: boolean;
  /** The tab said it is closing ("leave"). */
  away: boolean;
}

/** A guest that sends heartbeats and stays silent this long has left (closed tab, lost network). */
export const STALE_MS = 45_000;

/** Chat images the host keeps (the oldest are dropped). */
export const MAX_IMAGES = 30;

/**
 * Runs a room in the host's browser. Guests talk to it through the relay with the same protocol the old
 * WebSocket server used; every participant gets their own view, so hidden votes never leave the host.
 * Jira is reached only from here (the host's browser).
 */
export class HostEngine {
  private readonly room: Room;
  private jira: JiraGateway | null;
  private readonly onChange?: (room: Room) => void;
  private readonly conns = new Set<Conn>();
  /**
   * Chat images (id → data URL), newest last. Kept in memory on the host only — too big to persist
   * with the room or to repeat in every state — so after the host reloads, older images are gone.
   */
  private readonly images = new Map<string, string>();

  private readonly now: () => number;

  constructor(opts: HostEngineOptions) {
    this.room = opts.room;
    this.jira = opts.jira;
    this.onChange = opts.onChange;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Marks participants as gone whose connections went silent (no heartbeat for STALE_MS). Call it
   * every few seconds. Relays can't always tell the host that a tab was closed; this always works.
   */
  sweep(): void {
    let changed = false;
    for (const c of this.conns) {
      if (c.pid && c.heartbeat && !c.away && this.now() - c.lastSeen > STALE_MS) {
        c.away = true;
        if (!this.present(c.pid)) changed = this.room.leave(c.pid) || changed;
      }
    }
    if (changed) this.broadcast();
  }

  /** Is the participant still here on some connection? */
  private present(pid: string): boolean {
    return [...this.conns].some((c) => c.pid === pid && !c.away);
  }

  get roomId(): string { return this.room.id; }

  setJira(jira: JiraGateway | null): void { this.jira = jira; }

  connect(send: (m: ServerMessage) => void): PeerLink {
    const conn: Conn = { send, pid: null, lastSeen: this.now(), heartbeat: false, away: false };
    this.conns.add(conn);
    return {
      receive: (raw) => this.receive(conn, raw),
      close: () => this.disconnect(conn),
    };
  }

  /** Disconnects everyone (host tab closing). */
  dispose(): void {
    for (const c of [...this.conns]) this.disconnect(c);
  }

  private safeSend(conn: Conn, m: ServerMessage) {
    try { conn.send(m); } catch { /* channel closed mid-send */ }
  }

  private broadcast() {
    this.endStreamIfGone();
    for (const c of this.conns) if (c.pid) this.safeSend(c, { type: "state", room: slim(this.room.view(c.pid)) });
    this.onChange?.(this.room);
  }

  private disconnect(conn: Conn) {
    if (!this.conns.delete(conn) || !conn.pid) return;
    const pid = conn.pid;
    // Only mark offline if this participant has no other open link (multiple tabs).
    if (!this.present(pid) && this.room.leave(pid)) this.broadcast();
  }

  private async receive(conn: Conn, raw: string): Promise<void> {
    if (!this.conns.has(conn)) return;
    try {
      const msg = parseClientMessage(raw);
      conn.lastSeen = this.now();
      if (msg.type === "leave") {
        // The tab is closing: gone right away (unless another tab of theirs is still here).
        conn.away = true;
        if (conn.pid && !this.present(conn.pid) && this.room.leave(conn.pid)) this.broadcast();
        return;
      }
      // Anything else on this connection means they're here (back from a closed-looking tab,
      // a frozen phone, or after a silence).
      if (conn.away) {
        conn.away = false;
        if (conn.pid && this.room.rejoin(conn.pid)) this.broadcast();
      }
      if (msg.type === "ping") { conn.heartbeat = true; this.safeSend(conn, { type: "pong" }); return; }
      if (msg.type === "join") {
        if (conn.pid) throw new RoomError("INVALID", "Already joined");
        if (msg.roomId.toUpperCase() !== this.room.id) throw new RoomError("NOT_FOUND", "Room not found");
        const { participant, token } = this.room.join({ name: msg.name, role: msg.role, token: msg.token });
        conn.pid = participant.id;
        this.safeSend(conn, { type: "welcome", token, you: participant.id });
        for (const [id, data] of this.images) this.safeSend(conn, { type: "image", id, data });
        const s = this.streaming;
        if (s?.list && s.pid !== participant.id) this.safeSend(conn, { type: "stream", from: s.pid, name: s.name, kind: "list", list: s.list });
        this.broadcast();
        return;
      }
      if (!conn.pid) throw new RoomError("NOT_JOINED", "Join a room first");
      if (msg.type === "jira") { await this.jiraProxy(conn, conn.pid, msg); return; }
      if (msg.type === "stream") { this.stream(conn, conn.pid, msg); return; }
      if (msg.type === "cursor") {
        // Everyone's mouse, relayed to everyone else as is (it's anchored to what's on screen, and
        // over the card pane it only says "in the cards"). Nothing is stored or broadcast.
        const name = this.room.nameOf(conn.pid);
        for (const c of this.conns) if (c.pid && c.pid !== conn.pid) this.safeSend(c, { type: "cursor", from: conn.pid, name, spot: msg.spot });
        return;
      }
      await this.handle(conn.pid, msg);
    } catch (e) {
      const [code, message] =
        e instanceof ProtocolError ? ["BAD_MESSAGE", e.message]
        : e instanceof RoomError ? [e.code, e.message]
        : e instanceof JiraError ? ["JIRA", e.message]
        : ["INTERNAL", "Internal error"];
      if (code === "INTERNAL") console.error("[host] unexpected error", e);
      this.safeSend(conn, { type: "error", code, message });
    }
  }

  /** Who is streaming their import dialog right now, and the list they last showed (for late joiners). */
  private streaming: { pid: string; name: string; list: StreamList | null } | null = null;

  /**
   * Host or PM streams the import dialog: the list (when it changes) and the cursor/scroll (often)
   * go to everyone else. Nothing here touches the room state, so nothing is saved or broadcast.
   */
  private stream(conn: Conn, pid: string, msg: Extract<ClientMessage, { type: "stream" }>) {
    const name = this.room.nameOf(pid);
    if (msg.kind === "list") {
      if (!this.room.canModerate(pid)) throw new RoomError("FORBIDDEN", "Only the host or a PM can stream");
      this.streaming = { pid, name, list: msg.list };
    } else if (!this.streaming) {
      return; // nothing is being streamed
    } else if (msg.kind === "end") {
      if (this.streaming.pid !== pid) return; // only the presenter ends it
      this.streaming = null;
    }
    // Pointers: the presenter's and, while a stream is on, every viewer's (everyone sees everyone).
    const { type: _t, ...payload } = msg;
    for (const c of this.conns) if (c.pid && c !== conn && c.pid !== pid) this.safeSend(c, { type: "stream", from: pid, name, ...payload });
  }

  /** The streamer left or lost their role: tell everyone the stream is over. */
  private endStreamIfGone() {
    const s = this.streaming;
    if (!s || (this.present(s.pid) && this.room.canModerate(s.pid))) return;
    this.streaming = null;
    for (const c of this.conns) if (c.pid && c.pid !== s.pid) this.safeSend(c, { type: "stream", from: s.pid, name: s.name, kind: "end" });
  }

  /**
   * A PM's Jira read, run with the host's helper (the PM's browser never talks to Jira and never
   * sees the credentials). Only reads; the answer goes to the asking connection only.
   */
  private async jiraProxy(conn: Conn, pid: string, msg: Extract<ClientMessage, { type: "jira" }>) {
    const reply = (m: { ok: true; data: unknown } | { ok: false; error: string }) => this.safeSend(conn, { type: "jiraResult", reqId: msg.reqId, ...m });
    if (!this.room.canModerate(pid)) { reply({ ok: false, error: "Only the host or a PM can use Jira here" }); return; }
    const jira = this.jira;
    if (!jira) { reply({ ok: false, error: "The host's Jira helper is not connected right now" }); return; }
    const num = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid id"); return n; };
    const [a, b] = msg.args;
    try {
      let data: unknown;
      switch (msg.op) {
        case "searchBoards": data = await jira.searchBoards(String(a ?? "").slice(0, 200)); break;
        case "listBoards": data = await jira.listBoards(); break;
        case "getBoard": data = await jira.getBoard(num(a)); break;
        case "listSprints": data = await jira.listSprints(num(a)); break;
        case "getIssue": {
          // One ticket with its description (shortened) — for opening a row in the import list.
          const key = String(a ?? "");
          if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(key)) throw new Error("Invalid issue key");
          const [issue] = await jira.getIssues([key.toUpperCase()]);
          data = issue ? { ...issue, description: (issue.description ?? "").slice(0, MAX_DESCRIPTION_CHARS) } : null;
          break;
        }
        case "listIssues": {
          const o = (typeof b === "object" && b ? b : {}) as Record<string, unknown>;
          const opts: ListIssuesOptions = {
            ...(o.sprintId !== undefined ? { sprintId: num(o.sprintId) } : {}),
            ...(o.scope === "all" || o.scope === "backlog" ? { scope: o.scope } : {}),
            ...(typeof o.query === "string" && o.query.trim() ? { query: o.query.slice(0, 200) } : {}),
          };
          // Descriptions stay at the host (the import fetches them itself): answers stay small.
          data = (await jira.listIssues(num(a), opts)).slice(0, 300).map((i) => ({ ...i, description: "" }));
          break;
        }
      }
      reply({ ok: true, data });
    } catch (e) {
      reply({ ok: false, error: (e as Error).message || "Jira request failed" });
    }
  }

  private async handle(pid: string, msg: Exclude<ClientMessage, { type: "join" | "ping" | "leave" | "jira" | "stream" | "cursor" }>) {
    const room = this.room;
    switch (msg.type) {
      case "vote": room.vote(pid, msg.card); break;
      case "reveal": room.reveal(pid); break;
      case "nextRound": room.nextRound(pid); break;
      case "nextTicket": room.nextTicket(pid); break;
      case "reopen": room.reopen(pid, msg.ticketId); break;
      case "selectTicket": room.selectTicket(pid, msg.ticketId); break;
      case "removeTicket": room.removeTicket(pid, msg.ticketId); break;
      case "addTicket": room.addTicket(pid, { title: msg.title, description: msg.description }); break;
      case "setRule": room.setRule(pid, msg.rule); break;
      case "raiseHand": room.raiseHand(pid, msg.raised); break;
      case "react": room.react(pid, msg.messageId, msg.emoji); break;
      case "setModerator": room.setModerator(pid, msg.participantId, msg.moderator); break;
      case "chat": {
        if (!msg.image) { room.chat(pid, msg.text); break; }
        // The image travels once, on its own; the message (in every state) only refers to it.
        const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        room.chat(pid, msg.text, id);
        this.images.set(id, msg.image);
        while (this.images.size > MAX_IMAGES) this.images.delete(this.images.keys().next().value!);
        for (const c of this.conns) if (c.pid) this.safeSend(c, { type: "image", id, data: msg.image });
        break;
      }
      case "nudge": {
        // Only the pinged people hear about it; nothing in the room changes.
        const { from, targets } = room.nudge(pid, msg.participantId);
        for (const c of this.conns) if (c.pid && targets.includes(c.pid)) this.safeSend(c, { type: "nudged", from });
        return;
      }
      case "finalize": {
        const t = room.finalize(pid, msg.value);
        this.broadcast();
        if (t.source === "jira" && t.key) await this.writeback(t.id);
        return;
      }
      case "retryWriteback": {
        if (!room.canModerate(pid)) throw new RoomError("FORBIDDEN", "Only the host or a PM can do this");
        const t = room.getTicket(msg.ticketId);
        if (!t) throw new RoomError("NOT_FOUND", "Unknown ticket");
        if (t.status !== "estimated" || !t.key) throw new RoomError("BAD_PHASE", "Nothing to write back");
        await this.writeback(t.id);
        return;
      }
      case "importJira": {
        if (!room.canModerate(pid)) throw new RoomError("FORBIDDEN", "Only the host or a PM can do this");
        const jira = this.jira;
        if (!jira) throw new JiraError("Jira is not configured — open Jira settings on the start page");
        const existing = new Set(room.view(pid).tickets.map((t) => t.key));
        const keys = [...new Set(msg.issueKeys.map((k) => k.toUpperCase()))].filter((k) => !existing.has(k));
        const issues = keys.length ? await jira.getIssues(keys) : [];
        let first: string | undefined;
        for (const i of issues) {
          // A concurrent import may have added it while we awaited Jira.
          if (room.view(pid).tickets.some((t) => t.key === i.key)) continue;
          const t = room.addTicket(pid, {
            title: i.summary, key: i.key, description: i.description, url: i.url,
            source: "jira", currentEstimate: i.estimate, issueType: i.issueType, jiraStatus: i.status,
          });
          first ??= t.id;
        }
        // An idle session starts right away on the first imported ticket.
        if (first && room.view(pid).currentTicketId === null) room.selectTicket(pid, first);
        break;
      }
    }
    this.broadcast();
  }

  private async writeback(ticketId: string) {
    const room = this.room;
    const ticket = room.getTicket(ticketId);
    if (!ticket?.key || ticket.estimate === null) return;
    const estimate = ticket.estimate;
    const settle = (wb: { status: "synced" | "failed"; error?: string }) => {
      const now = room.getTicket(ticketId);
      // The ticket may have been removed or reopened while Jira was busy.
      if (!now || now.status !== "estimated" || now.estimate !== estimate) return;
      room.setWriteback(ticketId, wb);
      this.broadcast();
    };
    try {
      if (!this.jira) throw new Error("Jira is not configured — open Jira settings on the start page");
      room.setWriteback(ticketId, { status: "pending" });
      this.broadcast();
      await this.jira.writeEstimate(ticket.key, estimate, formatEstimateComment(ticket, room.name));
      settle({ status: "synced" });
    } catch (e) {
      settle({ status: "failed", error: (e as Error).message });
    }
  }
}

/** Descriptions can be long; only the ticket on the table needs one. */
function slim(view: RoomView): RoomView {
  return {
    ...view,
    tickets: view.tickets.map((t) => (t.id === view.currentTicketId || t.description === undefined ? t : { ...t, description: undefined })),
  };
}
