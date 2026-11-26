import { WebSocket, WebSocketServer } from "ws";
import { RoomError, type Room } from "@/core/room";
import { ProtocolError, parseClientMessage, type ClientMessage, type ServerMessage } from "@/core/protocol";
import { formatEstimateComment } from "@/jira/comment";
import { JiraError } from "@/jira/client";
import type { JiraGateway } from "@/jira/types";
import type { RoomRegistry } from "./registry";

interface Conn { room: Room; pid: string }

export interface Hub {
  wss: WebSocketServer;
  close(): void;
}

export function createHub(registry: RoomRegistry, jira: JiraGateway | null): Hub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const conns = new Map<WebSocket, Conn>();
  const alive = new WeakSet<WebSocket>();

  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const error = (ws: WebSocket, code: string, message: string) => send(ws, { type: "error", code, message });

  /** Every participant gets their own personalised view: hidden votes never leave the server. */
  function broadcast(room: Room) {
    for (const [ws, c] of conns) if (c.room === room) send(ws, { type: "state", room: room.view(c.pid) });
    registry.markDirty();
  }

  async function runWriteback(room: Room, ticketId: string) {
    const ticket = room.getTicket(ticketId);
    if (!ticket?.key || ticket.estimate === null) return;
    const estimate = ticket.estimate;
    const settle = (wb: { status: "synced" | "failed"; error?: string }) => {
      const now = room.getTicket(ticketId);
      // The ticket may have been removed or reopened while Jira was busy.
      if (!now || now.status !== "estimated" || now.estimate !== estimate) return;
      room.setWriteback(ticketId, wb);
      broadcast(room);
    };
    try {
      if (!jira) throw new Error("Jira is not configured on this server");
      room.setWriteback(ticketId, { status: "pending" });
      broadcast(room);
      await jira.writeEstimate(ticket.key, estimate, formatEstimateComment(ticket, room.name));
      settle({ status: "synced" });
    } catch (e) {
      settle({ status: "failed", error: (e as Error).message });
    }
  }

  async function handle(conn: Conn, msg: Exclude<ClientMessage, { type: "join" | "ping" }>) {
    const { room, pid } = conn;
    switch (msg.type) {
      case "vote": room.vote(pid, msg.card); break;
      case "reveal": room.reveal(pid); break;
      case "nextRound": room.nextRound(pid); break;
      case "reopen": room.reopen(pid, msg.ticketId); break;
      case "selectTicket": room.selectTicket(pid, msg.ticketId); break;
      case "removeTicket": room.removeTicket(pid, msg.ticketId); break;
      case "addTicket": room.addTicket(pid, { title: msg.title, description: msg.description }); break;
      case "setRule": room.setRule(pid, msg.rule); break;
      case "promote": room.promote(pid, msg.participantId); break;
      case "finalize": {
        const t = room.finalize(pid, msg.value);
        broadcast(room);
        if (t.source === "jira" && t.key) await runWriteback(room, t.id);
        return;
      }
      case "retryWriteback": {
        if (!room.isHost(pid)) throw new RoomError("FORBIDDEN", "Only the host can do this");
        const t = room.getTicket(msg.ticketId);
        if (!t) throw new RoomError("NOT_FOUND", "Unknown ticket");
        if (t.status !== "estimated" || !t.key) throw new RoomError("BAD_PHASE", "Nothing to write back");
        await runWriteback(room, t.id);
        return;
      }
      case "importJira": {
        if (!room.isHost(pid)) throw new RoomError("FORBIDDEN", "Only the host can do this");
        if (!jira) throw new JiraError("Jira is not configured on this server");
        const existing = new Set(room.view(pid).tickets.map((t) => t.key));
        const keys = [...new Set(msg.issueKeys.map((k) => k.toUpperCase()))].filter((k) => !existing.has(k));
        const issues = keys.length ? await jira.getIssues(keys) : [];
        for (const i of issues) {
          // A concurrent import may have added it while we awaited Jira.
          if (room.view(pid).tickets.some((t) => t.key === i.key)) continue;
          room.addTicket(pid, {
            title: i.summary, key: i.key, description: i.description, url: i.url,
            source: "jira", currentEstimate: i.estimate,
          });
        }
        break;
      }
    }
    broadcast(room);
  }

  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));

    ws.on("message", async (data) => {
      try {
        const msg = parseClientMessage(data.toString());
        if (msg.type === "ping") return send(ws, { type: "pong" });
        const conn = conns.get(ws);
        if (msg.type === "join") {
          if (conn) throw new RoomError("INVALID", "Already joined");
          const room = registry.get(msg.roomId.toUpperCase());
          if (!room) throw new RoomError("NOT_FOUND", "Room not found");
          const { participant, token } = room.join({ name: msg.name, role: msg.role, token: msg.token });
          conns.set(ws, { room, pid: participant.id });
          send(ws, { type: "welcome", token, you: participant.id });
          broadcast(room);
          return;
        }
        if (!conn) throw new RoomError("NOT_JOINED", "Join a room first");
        await handle(conn, msg);
      } catch (e) {
        if (e instanceof ProtocolError) error(ws, "BAD_MESSAGE", e.message);
        else if (e instanceof RoomError) error(ws, e.code, e.message);
        else if (e instanceof JiraError) error(ws, "JIRA", e.message);
        else { console.error("[ws] unexpected error", e); error(ws, "INTERNAL", "Internal error"); }
      }
    });

    ws.on("close", () => {
      const conn = conns.get(ws);
      conns.delete(ws);
      if (!conn) return;
      // Only mark offline if this participant has no other open socket (multiple tabs).
      const stillThere = [...conns.values()].some((c) => c.room === conn.room && c.pid === conn.pid);
      if (!stillThere) { conn.room.leave(conn.pid); broadcast(conn.room); }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    wss,
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
