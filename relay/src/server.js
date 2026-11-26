// @ts-check
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { attachRelay } from "./relay.js";

/**
 * HTTP server with the relay attached. GET answers a small health JSON; WebSocket upgrades join
 * the relay. `origins` (optional) restricts which sites may connect.
 * @param {import("./bus.js").MemoryBus | import("./bus.js").RedisBus} bus
 * @param {{ origins?: string[] }} [opts]
 */
export function createRelayServer(bus, opts = {}) {
  const origins = (opts.origins ?? []).map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "planning-poker-relay", bus: bus.kind }));
  });
  const wss = new WebSocketServer({
    server,
    maxPayload: 256 * 1024,
    verifyClient: origins.length ? ({ origin }) => origins.includes(origin) : undefined,
  });
  attachRelay(wss, bus);
  server.on("close", () => { for (const c of wss.clients) c.terminate(); wss.close(); });
  return server;
}
