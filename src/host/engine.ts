import { RoomError, type Room, type RoomView } from "@/core/room";
import { ProtocolError, parseClientMessage, type ClientMessage, type ServerMessage } from "@/core/protocol";
import { formatEstimateComment } from "@/jira/comment";
import { JiraError } from "@/jira/client";
import type { JiraGateway } from "@/jira/types";

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
}

interface Conn { send: (m: ServerMessage) => void; pid: string | null }

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

  constructor(opts: HostEngineOptions) {
    this.room = opts.room;
    this.jira = opts.jira;
    this.onChange = opts.onChange;
  }

  get roomId(): string { return this.room.id; }

  setJira(jira: JiraGateway | null): void { this.jira = jira; }

  connect(send: (m: ServerMessage) => void): PeerLink {
    const conn: Conn = { send, pid: null };
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
    for (const c of this.conns) if (c.pid) this.safeSend(c, { type: "state", room: slim(this.room.view(c.pid)) });
    this.onChange?.(this.room);
  }

  private disconnect(conn: Conn) {
    if (!this.conns.delete(conn) || !conn.pid) return;
    const pid = conn.pid;
    // Only mark offline if this participant has no other open link (multiple tabs).
    if (![...this.conns].some((c) => c.pid === pid)) { this.room.leave(pid); this.broadcast(); }
  }

  private async receive(conn: Conn, raw: string): Promise<void> {
    if (!this.conns.has(conn)) return;
    try {
      const msg = parseClientMessage(raw);
      if (msg.type === "ping") { this.safeSend(conn, { type: "pong" }); return; }
      if (msg.type === "join") {
        if (conn.pid) throw new RoomError("INVALID", "Already joined");
        if (msg.roomId.toUpperCase() !== this.room.id) throw new RoomError("NOT_FOUND", "Room not found");
        const { participant, token } = this.room.join({ name: msg.name, role: msg.role, token: msg.token });
        conn.pid = participant.id;
        this.safeSend(conn, { type: "welcome", token, you: participant.id });
        for (const [id, data] of this.images) this.safeSend(conn, { type: "image", id, data });
        this.broadcast();
        return;
      }
      if (!conn.pid) throw new RoomError("NOT_JOINED", "Join a room first");
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

  private async handle(pid: string, msg: Exclude<ClientMessage, { type: "join" | "ping" }>) {
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
        if (!room.isHost(pid)) throw new RoomError("FORBIDDEN", "Only the host can do this");
        const t = room.getTicket(msg.ticketId);
        if (!t) throw new RoomError("NOT_FOUND", "Unknown ticket");
        if (t.status !== "estimated" || !t.key) throw new RoomError("BAD_PHASE", "Nothing to write back");
        await this.writeback(t.id);
        return;
      }
      case "importJira": {
        if (!room.isHost(pid)) throw new RoomError("FORBIDDEN", "Only the host can do this");
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
