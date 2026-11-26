import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { JiraGateway } from "@/jira/types";
import { handleApi } from "./http";
import { RoomRegistry } from "./registry";
import { createHub } from "./ws";

export interface PokerServerOptions {
  jira: JiraGateway | null;
  dataDir?: string;
  persistDelayMs?: number;
  /** Fallback for non-API requests (Next.js). */
  nextHandler?: (req: IncomingMessage, res: ServerResponse) => unknown;
  /** Fallback for non-/ws upgrades (Next.js dev HMR). */
  nextUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown;
}

export interface PokerServer {
  server: Server;
  registry: RoomRegistry;
  close(): Promise<void>;
}

export function createPokerServer(opts: PokerServerOptions): PokerServer {
  const registry = new RoomRegistry({ dataDir: opts.dataDir, persistDelayMs: opts.persistDelayMs });
  const hub = createHub(registry, opts.jira);

  const server = createServer(async (req, res) => {
    if (await handleApi(req, res, registry, opts.jira)) return;
    if (opts.nextHandler) { await opts.nextHandler(req, res); return; }
    res.writeHead(404).end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit("connection", ws, req));
    else if (opts.nextUpgrade) opts.nextUpgrade(req, socket, head);
    else socket.destroy();
  });

  return {
    server,
    registry,
    close: () =>
      new Promise<void>((resolve) => {
        hub.close();
        registry.dispose();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
