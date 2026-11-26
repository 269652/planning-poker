// Vercel Function: the Planning Poker WebSocket relay at /api/relay.
// Plain Node pattern from https://vercel.com/docs/functions/websockets (an http.Server with `ws` attached).
// Needs Fluid compute (default for new projects). Works without Redis: guests that land on an
// instance without the host reconnect until they find it. Optional REDIS_URL/KV_URL (Redis from the
// Vercel Marketplace) routes across instances directly. Optional RELAY_ORIGINS
// (comma-separated) restricts which sites may connect.
import { busFromEnv } from "../src/bus.js";
import { createRelayServer } from "../src/server.js";

const server = createRelayServer(busFromEnv(process.env), {
  origins: process.env.RELAY_ORIGINS ? process.env.RELAY_ORIGINS.split(",") : [],
});

export default server;
