"use client";
import type { ClientMessage, ServerMessage } from "@/core/protocol";
import type { HostEngine, PeerLink } from "@/host/engine";

/**
 * Transport over the WebSocket relay (relay/ — deployed to Vercel). The relay only forwards:
 * the room runs in the host's browser (HostEngine) and every guest talks to it through the relay.
 * Connections are recycled every few minutes on Vercel; both sides reconnect transparently and
 * guests re-join with their token whenever the host (re)appears.
 */

export type HostState = "registering" | "online" | "taken" | "offline";
export type GuestState = "connecting" | "open" | "host-offline" | "reconnecting";

const PING_MS = 25_000;
const backoff = (attempt: number) => Math.min(500 * 2 ** attempt, 10_000);

function socketUrl(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Opens the room for guests through the relay. Returns a stop function. */
export function hostRoom(engine: HostEngine, opts: { url: string; hostKey: string }, onState: (s: HostState, detail?: string) => void): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const links = new Map<string, PeerLink>();

  const dropLinks = () => { for (const l of links.values()) l.close(); links.clear(); };
  const linkFor = (peer: string, socket: WebSocket) => {
    let l = links.get(peer);
    if (!l) {
      l = engine.connect((m: ServerMessage) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ to: peer, data: JSON.stringify(m) }));
      });
      links.set(peer, l);
    }
    return l;
  };

  const connect = () => {
    if (stopped) return;
    onState(attempt === 0 ? "registering" : "offline");
    const socket = new WebSocket(socketUrl(opts.url, { room: engine.roomId, role: "host", key: opts.hostKey }));
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      onState("online");
      ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'), PING_MS);
    };
    socket.onmessage = (e) => {
      let m: { type?: string; peer?: string; data?: string };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "open" && m.peer) linkFor(m.peer, socket);
      else if (m.type === "msg" && m.peer && typeof m.data === "string") void linkFor(m.peer, socket).receive(m.data);
      else if (m.type === "close" && m.peer) { links.get(m.peer)?.close(); links.delete(m.peer); }
    };
    socket.onclose = (e) => {
      clearInterval(ping);
      if (ws !== socket) return;
      // Guests are offline until they re-join after the host is back.
      dropLinks();
      if (stopped) return;
      if (e.code === 4009) { onState("taken", "This room was opened in another tab."); return; }
      if (e.code === 4003) { onState("taken", "This room is hosted from another browser."); return; }
      onState("offline", e.reason || undefined);
      retry = setTimeout(connect, backoff(attempt++));
    };
  };
  connect();

  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(ping);
    dropLinks();
    ws?.close();
  };
}

/** Connects a guest to the room's host via the relay and keeps reconnecting. */
export function joinRoom(roomId: string, handlers: {
  onOpen: () => void;
  onMessage: (m: ServerMessage) => void;
  onState: (s: GuestState) => void;
}, url: string): { send: (m: ClientMessage) => boolean; stop: () => void } {
  let stopped = false;
  let ws: WebSocket | null = null;
  let hostOnline = false;
  let attempt = 0;
  let hops = 0;
  let hopping = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let hopTimer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  /**
   * Without a shared bus (no Redis) the relay only knows the connections on its own instance. If the
   * host is not here, reconnect after a moment: Vercel spreads connections over its instances, so a
   * guest soon lands where the host is (and finds it again after the host itself reconnects).
   */
  const scheduleHop = (socket: WebSocket) => {
    clearTimeout(hopTimer);
    hopTimer = setTimeout(() => {
      if (stopped || hostOnline || ws !== socket) return;
      hopping = true;
      socket.close();
    }, Math.min(1500 * 1.5 ** hops++, 10_000));
  };

  const connect = () => {
    if (stopped) return;
    if (!hopping) handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(socketUrl(url, { room: roomId, role: "guest" }));
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'), PING_MS);
    };
    socket.onmessage = (e) => {
      let m: { type?: string; online?: boolean; data?: string };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "host") {
        hostOnline = !!m.online;
        handlers.onState(hostOnline ? "open" : "host-offline");
        if (hostOnline) {
          hops = 0;
          clearTimeout(hopTimer);
          // (Re-)join whenever the host is there: after our reconnect, and after the host's.
          handlers.onOpen();
        } else scheduleHop(socket);
      } else if (m.type === "msg" && typeof m.data === "string") {
        try { handlers.onMessage(JSON.parse(m.data) as ServerMessage); } catch { /* ignore garbage */ }
      }
    };
    socket.onclose = () => {
      clearInterval(ping);
      clearTimeout(hopTimer);
      if (ws !== socket || stopped) return;
      hostOnline = false;
      // A deliberate hop: reconnect right away and keep showing "host offline" rather than "reconnecting".
      if (hopping) { retry = setTimeout(() => { connect(); hopping = false; }, 100); return; }
      handlers.onState("reconnecting");
      retry = setTimeout(connect, backoff(attempt++));
    };
  };
  connect();

  return {
    send: (m) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !hostOnline) return false;
      ws.send(JSON.stringify({ data: JSON.stringify(m) }));
      return true;
    },
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(hopTimer);
      clearInterval(ping);
      ws?.close();
    },
  };
}
