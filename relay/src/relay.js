// @ts-check
/**
 * Planning Poker relay: forwards messages between a room's host and its guests. It keeps no room
 * state — the room runs in the host's browser — and routes everything through the bus, so the
 * host and guests may be connected to different instances.
 *
 * Connect: wss://…/api/relay?room=CODE&role=host&key=SECRET   or   ?room=CODE&role=guest
 *
 * host  → relay: { to: peer, data }          relay → host:  { type: "open"|"close", peer } | { type: "msg", peer, data }
 * guest → relay: { data }                    relay → guest: { type: "host", online } | { type: "msg", data }
 * both  → relay: { type: "ping" }            relay → both:  { type: "pong" } | { type: "error", message }
 *
 * Close codes: 4400 bad request · 4003 room is hosted with another key · 4009 hosted in a newer tab.
 */
import { createHash, randomUUID } from "node:crypto";

const CODE = /^[A-HJKMNP-Z2-9]{8}$/;
const KEY = /^[A-Za-z0-9_-]{32,128}$/;
const PEER = /^[0-9a-f-]{36}$/;
const MAX_DATA = 200 * 1024;
const HOST_KEY_TTL = 30 * 24 * 3600; // a room stays reserved for its host for 30 days after last use
const ONLINE_TTL = 90; // the host refreshes this with every ping (~25 s)

const ch = {
  host: (/** @type {string} */ r) => `pp:${r}:host`,
  guests: (/** @type {string} */ r) => `pp:${r}:guests`,
  session: (/** @type {string} */ r) => `pp:${r}:session`,
  peer: (/** @type {string} */ r, /** @type {string} */ p) => `pp:${r}:peer:${p}`,
  key: (/** @type {string} */ r) => `pp:${r}:key`,
  online: (/** @type {string} */ r) => `pp:${r}:online`,
};

/**
 * @param {import("ws").WebSocketServer} wss
 * @param {import("./bus.js").MemoryBus | import("./bus.js").RedisBus} bus
 */
export function attachRelay(wss, bus) {
  wss.on("connection", (ws, req) => {
    handle(ws, req.url ?? "/", bus).catch((e) => {
      console.error("[relay]", e);
      try { ws.close(1011, "relay error"); } catch { /* already closed */ }
    });
  });
}

/**
 * @param {import("ws").WebSocket} ws
 * @param {string} rawUrl
 * @param {import("./bus.js").MemoryBus | import("./bus.js").RedisBus} bus
 */
async function handle(ws, rawUrl, bus) {
  const url = new URL(rawUrl, "http://relay.local");
  const room = url.searchParams.get("room") ?? "";
  const role = url.searchParams.get("role");
  const key = url.searchParams.get("key") ?? "";
  if (!CODE.test(room) || (role !== "host" && role !== "guest") || (role === "host" && !KEY.test(key))) {
    ws.close(4400, "bad request");
    return;
  }

  /** @param {unknown} m */
  const send = (m) => { if (ws.readyState === ws.OPEN) ws.send(typeof m === "string" ? m : JSON.stringify(m)); };
  /** @type {(() => Promise<void>)[]} */
  const cleanup = [];
  let closed = false;
  /** @type {((raw: string) => Promise<void>) | null} */
  let onMessage = null;
  /** @type {string[]} */
  const early = [];
  ws.on("message", (d) => { const raw = d.toString(); if (onMessage) void onMessage(raw); else early.push(raw); });
  /** @type {(() => Promise<void>) | null} */
  let onClose = null;
  ws.on("close", () => { closed = true; void (async () => { for (const c of cleanup.splice(0)) await c().catch(() => {}); await onClose?.(); })(); });

  /** @param {string} raw */
  const parse = (raw) => {
    try { const m = JSON.parse(raw); return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch { return null; }
  };

  if (role === "host") {
    const hash = createHash("sha256").update(key).digest("hex");
    let owner = await bus.get(ch.key(room));
    if (!owner && (await bus.setIfAbsent(ch.key(room), hash, HOST_KEY_TTL))) owner = hash;
    owner ??= await bus.get(ch.key(room));
    if (owner !== hash) { ws.close(4003, "room is hosted with another key"); return; }
    await bus.set(ch.key(room), hash, HOST_KEY_TTL);

    const session = randomUUID();
    cleanup.push(await bus.subscribe(ch.session(room), (s) => {
      if (s !== session) { send({ type: "replaced" }); ws.close(4009, "hosted in a newer tab"); }
    }));
    cleanup.push(await bus.subscribe(ch.host(room), (m) => send(m)));
    if (closed) { for (const c of cleanup.splice(0)) await c(); return; }
    await bus.publish(ch.session(room), session);
    await bus.set(ch.online(room), session, ONLINE_TTL);
    await bus.publish(ch.guests(room), JSON.stringify({ type: "host", online: true }));

    onClose = async () => {
      if ((await bus.get(ch.online(room))) === session) {
        await bus.del(ch.online(room));
        await bus.publish(ch.guests(room), JSON.stringify({ type: "host", online: false }));
      }
    };
    onMessage = async (raw) => {
      const m = parse(raw);
      if (m?.type === "ping") { send({ type: "pong" }); await bus.set(ch.online(room), session, ONLINE_TTL); return; }
      if (!m || typeof m.to !== "string" || !PEER.test(m.to) || typeof m.data !== "string" || m.data.length > MAX_DATA) {
        send({ type: "error", message: "expected { to: peer, data: string }" });
        return;
      }
      await bus.publish(ch.peer(room, m.to), JSON.stringify({ type: "msg", data: m.data }));
    };
  } else {
    const peer = randomUUID();
    cleanup.push(await bus.subscribe(ch.peer(room, peer), (m) => send(m)));
    cleanup.push(await bus.subscribe(ch.guests(room), (m) => send(m)));
    if (closed) { for (const c of cleanup.splice(0)) await c(); return; }
    send({ type: "host", online: (await bus.get(ch.online(room))) !== null });
    await bus.publish(ch.host(room), JSON.stringify({ type: "open", peer }));

    onClose = async () => { await bus.publish(ch.host(room), JSON.stringify({ type: "close", peer })); };
    onMessage = async (raw) => {
      const m = parse(raw);
      if (m?.type === "ping") { send({ type: "pong" }); return; }
      if (!m || typeof m.data !== "string" || m.data.length > MAX_DATA) { send({ type: "error", message: "expected { data: string }" }); return; }
      await bus.publish(ch.host(room), JSON.stringify({ type: "msg", peer, data: m.data }));
    };
  }

  for (const raw of early.splice(0)) await onMessage(raw);
  if (closed) await onClose?.();
}
