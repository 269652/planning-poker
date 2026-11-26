import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RoomManager } from './roomManager';

export interface RealtimeOptions {
  path?: string;
  /** Ping interval; dead sockets are terminated after one missed pong. 0 disables. */
  heartbeatMs?: number;
  allowedOrigins?: string[];
  /** Run `manager.sweep` every N ms with this idle threshold. 0 disables. */
  sweepEveryMs?: number;
  roomIdleMs?: number;
}

/**
 * Browsers always send an Origin on websocket upgrades and websockets are not
 * covered by CORS, so we only accept same-host origins (or an explicit
 * allow-list) to stop other sites from driving a visitor's connection.
 */
export function isOriginAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // non-browser client
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Attach the planning-poker websocket endpoint (default `/ws`) to an HTTP server. */
export function attachRealtime(server: Server, manager: RoomManager, opts: RealtimeOptions = {}) {
  const path = opts.path ?? '/ws';
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const alive = new WeakSet<WebSocket>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== path) return; // leave other upgrades (Next.js HMR) to their handlers
    if (!isOriginAllowed(req.headers.origin, req.headers.host, opts.allowedOrigins ?? [])) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    const conn = { send: (data: string) => ws.readyState === WebSocket.OPEN && ws.send(data) };
    ws.on('message', (data) => {
      manager.handleMessage(conn, data.toString()).catch((e) => console.error('handleMessage failed', e));
    });
    ws.on('close', () => manager.disconnect(conn));
    ws.on('error', () => {});
  });

  const timers: NodeJS.Timeout[] = [];
  if (heartbeatMs > 0) {
    timers.push(
      setInterval(() => {
        for (const ws of wss.clients) {
          if (!alive.has(ws)) {
            ws.terminate();
            continue;
          }
          alive.delete(ws);
          ws.ping();
        }
      }, heartbeatMs),
    );
  }
  if (opts.sweepEveryMs) {
    timers.push(setInterval(() => manager.sweep(opts.roomIdleMs ?? 6 * 3600_000), opts.sweepEveryMs));
  }
  timers.forEach((t) => t.unref());

  return {
    close() {
      timers.forEach(clearInterval);
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
