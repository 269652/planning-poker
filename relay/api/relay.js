// Vercel Function: the Planning Poker WebSocket relay at /api/relay.
// Plain Node pattern from https://vercel.com/docs/functions/websockets (an http.Server with `ws` attached).
// Needs Fluid compute (default for new projects) and, for more than one instance, Redis:
// add Upstash Redis from the Vercel Marketplace (sets REDIS_URL/KV_URL). Optional RELAY_ORIGINS
// (comma-separated) restricts which sites may connect.
import { busFromEnv } from "../src/bus.js";
import { createRelayServer } from "../src/server.js";

const server = createRelayServer(busFromEnv(process.env), {
  origins: process.env.RELAY_ORIGINS ? process.env.RELAY_ORIGINS.split(",") : [],
});

export default server;
