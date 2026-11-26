/**
 * Custom Next.js server: serves the UI and the planning-poker websocket (/ws) on one port.
 *   dev:   npm run dev
 *   prod:  npm run build && npm start
 */
import { createServer } from 'node:http';
import { parse } from 'node:url';
import { loadEnvConfig } from '@next/env';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
loadEnvConfig(process.cwd(), dev);

async function main() {
  // Imported after env loading so Jira config sees .env / .env.local.
  const { createGateway } = await import('./src/jira/gateway');
  const { RoomManager } = await import('./src/server/roomManager');
  const { attachRealtime } = await import('./src/server/ws');

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  const gateway = createGateway(process.env); // throws on partial Jira config -> fail fast
  const app = next({ dev, hostname: host, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeNext = app.getUpgradeHandler(); // Next's own websocket (HMR in dev)

  const server = createServer((req, res) => handle(req, res, parse(req.url ?? '/', true)));
  const manager = new RoomManager({ gateway });
  attachRealtime(server, manager, {
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    sweepEveryMs: 10 * 60_000,
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) upgradeNext(req, socket, head);
  });

  server.listen(port, host, () => {
    const jira = gateway ? (gateway.mode === 'mock' ? 'MOCK (demo data)' : 'enabled') : 'disabled (manual tickets only)';
    console.log(`> Planning Poker ready on http://localhost:${port}  [${dev ? 'dev' : 'prod'}]  Jira: ${jira}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
