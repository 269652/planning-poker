// The WebSocket relay as a route of the Vercel deployment itself (wss://<site>/api/relay), using
// upgradeWebSocket() from @vercel/functions (https://vercel.com/docs/functions/websockets).
// Only built on Vercel: the `.vercel.ts` page extension is enabled in next.config.mjs when VERCEL is set,
// so the static GitHub Pages export never sees this file.
import { upgradeWebSocket } from "@vercel/functions";
import { busFromEnv } from "../../../../relay/src/bus.js";
import { handleConnection } from "../../../../relay/src/relay.js";

export const dynamic = "force-dynamic";
/** Vercel closes WebSockets at this limit; clients reconnect transparently. */
export const maxDuration = 300;

const bus = busFromEnv(process.env);
const origins = (process.env.RELAY_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);

export async function GET(request: Request): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ ok: true, service: "planning-poker-relay", bus: bus.kind }, { headers: { "cache-control": "no-store" } });
  }
  const origin = request.headers.get("origin") ?? "";
  if (origins.length > 0 && !origins.includes(origin)) return new Response("origin not allowed", { status: 403 });
  return upgradeWebSocket((ws) => handleConnection(ws, request.url, bus), { maxPayload: 256 * 1024 });
}
