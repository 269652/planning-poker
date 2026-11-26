/**
 * Single-process server: Next.js (UI) + WebSocket hub (/ws) + REST API (/api/*).
 *   npm run dev     -> development (HMR)
 *   npm run build && npm start -> production
 *   npm run demo    -> development with a built-in mock Jira (no credentials needed)
 */
import next from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { createPokerServer } from "./src/server/app";
import { jiraFromEnv } from "./src/jira/config";

const dev = process.env.NODE_ENV !== "production";
loadEnvConfig(process.cwd(), dev);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

async function main() {
  const jira = jiraFromEnv(process.env);
  const app = next({ dev, hostname: host, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const poker = createPokerServer({
    jira,
    dataDir,
    nextHandler: (req, res) => handle(req, res),
    nextUpgrade: (req, socket, head) => upgrade(req, socket, head),
  });

  poker.server.listen(port, host, () => {
    console.log(`\n  Planning Poker ready on http://localhost:${port}`);
    console.log(`  Jira: ${jira ? (jira.kind === "mock" ? "MOCK (demo data)" : "connected via env config") : "not configured (manual tickets only)"}`);
    console.log(`  Data: ${dataDir}\n`);
  });

  const stop = async () => { await poker.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
