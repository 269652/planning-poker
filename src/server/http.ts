import type { IncomingMessage, ServerResponse } from "node:http";
import { JiraError } from "@/jira/client";
import type { JiraGateway } from "@/jira/types";
import type { RoomRegistry } from "./registry";

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

/** Returns true when the request was handled; false to fall through (e.g. to Next.js). */
export async function handleApi(
  req: IncomingMessage, res: ServerResponse, registry: RoomRegistry, jira: JiraGateway | null,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  if (!p.startsWith("/api/")) return false;
  const method = req.method ?? "GET";

  try {
    if (p === "/api/jira/status" && method === "GET") {
      json(res, 200, { configured: !!jira, kind: jira?.kind ?? null });
      return true;
    }

    if (p === "/api/rooms" && method === "POST") {
      const body = (await readBody(req).catch(() => null)) as { name?: unknown; rule?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (!name) { json(res, 400, { error: "name is required" }); return true; }
      const rule = body?.rule === "adjacent" ? "adjacent" : "unanimous";
      const room = registry.create(name, rule);
      json(res, 201, { id: room.id, name: room.name });
      return true;
    }

    const m = p.match(/^\/api\/rooms\/([A-Za-z0-9]+)(\/.*)?$/);
    if (!m) { json(res, 404, { error: "not found" }); return true; }
    const room = registry.get(m[1].toUpperCase());
    if (!room) { json(res, 404, { error: "room not found" }); return true; }
    const rest = m[2] ?? "";

    if (rest === "" && method === "GET") {
      json(res, 200, { id: room.id, name: room.name });
      return true;
    }

    // Everything below is host-only and authenticated by the secret participant token.
    const tokenHeader = req.headers["x-participant-token"];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const pid = room.authenticate(token);
    if (!pid) { json(res, 401, { error: "participant token required" }); return true; }
    if (!room.isHost(pid)) { json(res, 403, { error: "host only" }); return true; }

    if (rest === "/export" && method === "GET") {
      json(res, 200, room.exportState());
      return true;
    }

    if (rest.startsWith("/jira/") && method === "GET") {
      if (!jira) { json(res, 503, { error: "Jira is not configured on this server" }); return true; }
      if (rest === "/jira/boards") {
        json(res, 200, { boards: await jira.listBoards() });
        return true;
      }
      const sub = rest.match(/^\/jira\/boards\/(\d+)\/(sprints|issues)$/);
      if (sub) {
        const boardId = Number(sub[1]);
        if (sub[2] === "sprints") json(res, 200, { sprints: await jira.listSprints(boardId) });
        else {
          const sp = url.searchParams.get("sprintId");
          json(res, 200, { issues: await jira.listIssues(boardId, sp && /^\d+$/.test(sp) ? { sprintId: Number(sp) } : {}) });
        }
        return true;
      }
    }

    json(res, 404, { error: "not found" });
    return true;
  } catch (e) {
    if (e instanceof JiraError) json(res, 502, { error: e.message });
    else { console.error("[http] unexpected error", e); json(res, 500, { error: "internal error" }); }
    return true;
  }
}
