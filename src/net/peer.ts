"use client";
import type { DataConnection, Peer, PeerError } from "peerjs";
import type { ClientMessage, ServerMessage } from "@/core/protocol";
import { peerIdFor } from "@/core/roomId";
import type { HostEngine } from "@/host/engine";

/**
 * WebRTC transport via PeerJS. Signaling (the handshake) uses the public PeerJS server; after that
 * every message flows peer-to-peer over an encrypted data channel. The host registers the id
 * derived from the room code, so the code is all a guest needs.
 */
async function loadPeer(): Promise<typeof Peer> {
  return (await import("peerjs")).Peer;
}

export type HostPeerState = "registering" | "online" | "taken" | "offline";

/** Opens the room for guests. Returns a stop function. */
export function hostRoom(engine: HostEngine, onState: (s: HostPeerState, detail?: string) => void): () => void {
  let stopped = false;
  let peer: Peer | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const conns = new Set<DataConnection>();

  const start = async () => {
    const PeerCtor = await loadPeer();
    if (stopped) return;
    onState("registering");
    const p = new PeerCtor(peerIdFor(engine.roomId), { debug: 1 });
    peer = p;
    p.on("open", () => onState("online"));
    p.on("connection", (conn) => {
      conns.add(conn);
      let link: ReturnType<HostEngine["connect"]> | null = null;
      conn.on("open", () => {
        link = engine.connect((m: ServerMessage) => { if (conn.open) conn.send(JSON.stringify(m)); });
      });
      conn.on("data", (d) => { void link?.receive(typeof d === "string" ? d : JSON.stringify(d)); });
      const drop = () => { conns.delete(conn); link?.close(); link = null; };
      conn.on("close", drop);
      conn.on("error", drop);
    });
    // Lost the signaling server only: open data channels keep working; re-register for new guests.
    p.on("disconnected", () => { if (!stopped && !p.destroyed) { onState("offline", "Reconnecting to the signaling server…"); p.reconnect(); } });
    p.on("error", (err: PeerError<string>) => {
      if (stopped) return;
      if (err.type === "unavailable-id") {
        // Another tab hosts this room — or the id of a just-closed tab has not been released yet.
        onState("taken");
        p.destroy();
        retry = setTimeout(start, 5000);
      } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
        onState("offline", err.message);
        p.destroy();
        retry = setTimeout(start, 4000);
      } else {
        console.warn("[peer] host error", err.type, err.message);
      }
    });
  };
  // Deferred a tick: React dev mode mounts effects twice; the first mount is cancelled before it registers.
  retry = setTimeout(start, 0);

  return () => {
    stopped = true;
    clearTimeout(retry);
    for (const c of conns) c.close();
    peer?.destroy();
  };
}

export type GuestState = "connecting" | "open" | "host-offline" | "reconnecting";

/** Connects a guest to the room's host and keeps reconnecting. Returns send + stop. */
export function joinRoom(roomId: string, handlers: {
  onOpen: () => void;
  onMessage: (m: ServerMessage) => void;
  onState: (s: GuestState) => void;
}): { send: (m: ClientMessage) => boolean; stop: () => void } {
  let stopped = false;
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (state: GuestState) => {
    if (stopped) return;
    handlers.onState(state);
    clearTimeout(timer);
    timer = setTimeout(dial, Math.min(1000 * 2 ** attempt++, 10_000));
  };

  const dial = () => {
    if (stopped || !peer || peer.destroyed) return;
    if (peer.disconnected) { peer.reconnect(); return; }
    conn?.close();
    const c = peer.connect(peerIdFor(roomId), { reliable: true });
    conn = c;
    // A connection that never opens (NAT trouble, host gone) is retried.
    const openTimeout = setTimeout(() => { if (!c.open) { c.close(); schedule("reconnecting"); } }, 12_000);
    c.on("open", () => {
      clearTimeout(openTimeout);
      attempt = 0;
      handlers.onState("open");
      handlers.onOpen();
    });
    c.on("data", (d) => {
      try { handlers.onMessage(JSON.parse(typeof d === "string" ? d : JSON.stringify(d)) as ServerMessage); } catch { /* ignore garbage */ }
    });
    c.on("close", () => { clearTimeout(openTimeout); if (conn === c) schedule("reconnecting"); });
    c.on("error", () => { clearTimeout(openTimeout); if (conn === c) schedule("reconnecting"); });
  };

  const begin = async () => {
    const PeerCtor = await loadPeer();
    if (stopped) return;
    handlers.onState("connecting");
    const p = new PeerCtor({ debug: 1 });
    peer = p;
    p.on("open", dial);
    p.on("disconnected", () => { if (!stopped) schedule("reconnecting"); });
    p.on("error", (err: PeerError<string>) => {
      if (stopped) return;
      if (err.type === "peer-unavailable") schedule("host-offline");
      else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) schedule("reconnecting");
      else console.warn("[peer] guest error", err.type, err.message);
    });
  };
  // Deferred a tick so React's double-mount in dev does not open two peers.
  timer = setTimeout(begin, 0);

  return {
    send: (m) => {
      if (!conn?.open) return false;
      conn.send(JSON.stringify(m));
      return true;
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      conn?.close();
      peer?.destroy();
    },
  };
}
