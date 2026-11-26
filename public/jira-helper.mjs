#!/usr/bin/env node
// Planning Poker — local Jira helper (no dependencies, Node >= 18).
//
// The host of a planning poker room runs this on their own machine. It reads the Jira credentials
// from a .env file, so they never enter the browser, and lets the poker page (and only that page)
// call the few Jira endpoints the app needs. Jira servers usually block browser calls from other
// sites (CORS); the helper answers those itself.
//
//   node jira-helper.mjs                                   (reads ./.env.local or ./.env)
//   node jira-helper.mjs --origin https://other.site --env path/to/.env --port 8787
//
// This project's sites (Vercel, GitHub Pages, localhost) are always allowed — see DEFAULT_ORIGINS.
//
// .env:  JIRA_BASE_URL (or JIRA_URL), JIRA_API_TOKEN (or JIRA_PERSONAL_TOKEN), JIRA_AUTH=basic|bearer,
//        JIRA_EMAIL (or JIRA_USERNAME; for basic auth), JIRA_STORY_POINTS_FIELD (optional),
//        HELPER_ORIGINS (comma-separated, optional), HELPER_PORT (optional)
//
// Safety: listens on 127.0.0.1 only; answers only the allowed origins; forwards only the listed
// endpoints (read boards/issues, set the story points field, add a comment); drops cookies.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEY = "[A-Za-z][A-Za-z0-9_]*-\\d+";
const ID = "\\d+";
/** Every Jira call the app makes — nothing else is forwarded. */
const ROUTES = [
  ["GET", `/rest/api/2/myself`],
  ["GET", `/rest/api/2/field`],
  ["GET", `/rest/api/2/issue/${KEY}`],
  ["GET", `/rest/agile/1.0/board`],
  ["GET", `/rest/agile/1.0/board/${ID}`],
  ["GET", `/rest/agile/1.0/board/${ID}/(?:sprint|backlog|issue)`],
  ["GET", `/rest/agile/1.0/sprint/${ID}/issue`],
  ["PUT", `/rest/api/2/issue/${KEY}`],
  ["POST", `/rest/api/2/issue/${KEY}/comment`],
].map(([method, p]) => ({ method, re: new RegExp(`^${p}$`) }));

/**
 * Sites that may use the helper without any flags: this project's deployments and local development.
 * Exact origins only — never a wildcard such as *.vercel.app, since an allowed site acts as your Jira user.
 */
export const DEFAULT_ORIGINS = [
  "https://planning-poker-psi-five.vercel.app",
  "https://269652.github.io",
  "http://localhost:3000",
  "http://localhost:4173",
];

/** Defaults plus --origin flags plus HELPER_ORIGINS (comma-separated), normalised, without duplicates. */
export function allowedOrigins(flags, env) {
  const extra = [...flags, ...(env.HELPER_ORIGINS ?? "").split(",")];
  const all = [...DEFAULT_ORIGINS, ...extra].map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return [...new Set(all)];
}

/** Parses .env text (comments, `export`, quotes, CRLF). */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1));
    else v = v.replace(/\s+#.*$/, "").trim();
    env[m[1]] = v;
  }
  return env;
}

/** Jira connection settings from env variables (documented names plus common aliases). */
export function configFromEnv(env) {
  const pick = (...keys) => keys.map((k) => env[k]).find((v) => v !== undefined && v !== "");
  const baseUrl = pick("JIRA_BASE_URL", "JIRA_URL", "JIRA_HOST");
  if (!baseUrl) throw new Error("JIRA_BASE_URL is missing (e.g. https://your-company.atlassian.net or https://jira.example.com/jira)");
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) throw new Error("JIRA_BASE_URL must start with http:// or https://");
  const apiToken = pick("JIRA_API_TOKEN", "JIRA_TOKEN");
  const pat = pick("JIRA_PERSONAL_TOKEN", "JIRA_PAT");
  const token = apiToken ?? pat;
  if (!token) throw new Error("JIRA_API_TOKEN (Cloud API token) or JIRA_PERSONAL_TOKEN (Server/DC) is missing");
  const email = pick("JIRA_EMAIL", "JIRA_USERNAME", "JIRA_USER");
  const explicit = (env.JIRA_AUTH ?? "").toLowerCase();
  const auth = explicit === "basic" || explicit === "bearer" ? explicit : pat && !apiToken ? "bearer" : email ? "basic" : "bearer";
  if (auth === "basic" && !email) throw new Error("JIRA_EMAIL is required for basic auth (or set JIRA_AUTH=bearer for a personal access token)");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, auth, email, storyPointsField: pick("JIRA_STORY_POINTS_FIELD") };
}

/**
 * @param {{ jira: { baseUrl: string, token: string, auth: "basic" | "bearer", email?: string, storyPointsField?: string },
 *           origins: string[], fetchImpl?: typeof fetch }} opts
 */
export function createJiraHelper({ jira, origins, fetchImpl = fetch }) {
  const base = jira.baseUrl.replace(/\/+$/, "");
  const authorization = jira.auth === "bearer"
    ? `Bearer ${jira.token}`
    : `Basic ${Buffer.from(`${jira.email}:${jira.token}`, "utf8").toString("base64")}`;
  const allowed = new Set(origins.map((o) => o.replace(/\/+$/, "")));

  const callJira = (method, pathAndQuery, body, contentType) => fetchImpl(base + pathAndQuery, {
    method,
    headers: {
      authorization,
      accept: "application/json",
      ...(contentType ? { "content-type": contentType } : {}),
      // Jira Server/DC rejects some writes from non-browser clients without this (XSRF check).
      "x-atlassian-token": "no-check",
    },
    body,
    redirect: "manual",
  });

  async function status() {
    try {
      const r = await callJira("GET", "/rest/api/2/myself");
      if (!r.ok) return { ok: false, error: `Jira answered ${r.status} for ${base} — check the token in .env` };
      const me = await r.json();
      return { ok: true, user: me.displayName ?? me.name ?? me.emailAddress ?? "unknown", jiraUrl: base, storyPointsField: jira.storyPointsField ?? null };
    } catch (e) {
      return { ok: false, error: `Could not reach Jira at ${base}: ${e instanceof Error ? e.message : e}` };
    }
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && allowed.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : null;
    const reply = (code, body) => {
      res.writeHead(code, { "content-type": "application/json", ...(cors ?? {}) });
      res.end(JSON.stringify(body));
    };
    if (!cors) return reply(403, { error: `Origin ${origin ?? "(none)"} is not allowed. Start the helper with --origin <the planning poker site>.` });

    const url = new URL(req.url ?? "/", "http://helper.local");
    if (req.method === "OPTIONS") {
      const headers = {
        ...cors,
        "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Accept",
        "access-control-max-age": "600",
      };
      // Chrome's Private Network Access: a public site calling a service on this machine.
      if (req.headers["access-control-request-private-network"] === "true") headers["access-control-allow-private-network"] = "true";
      res.writeHead(204, headers);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/status") return reply(200, await status());

    const route = ROUTES.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return reply(404, { error: `${req.method} ${url.pathname} is not forwarded by the helper.` });

    let body;
    if (req.method !== "GET") {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 64 * 1024) return reply(413, { error: "Body too large" }); chunks.push(c); }
      body = Buffer.concat(chunks).toString("utf8");
      if (!validBody(req.method, body)) return reply(400, { error: "Only a single numeric field update or a plain comment is forwarded." });
    }
    try {
      const r = await callJira(req.method, url.pathname + url.search, body, body ? "application/json" : undefined);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { ...cors, "content-type": r.headers.get("content-type") ?? "application/json" });
      res.end(buf);
    } catch (e) {
      reply(502, { error: `Could not reach Jira at ${base}: ${e instanceof Error ? e.message : e}` });
    }
  });
  server.jiraStatus = status;
  return server;
}

/** PUT may only set one numeric field (the story points); POST may only add a text comment. */
function validBody(method, text) {
  let b;
  try { b = JSON.parse(text); } catch { return false; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  if (method === "PUT") {
    const keys = Object.keys(b);
    const f = b.fields;
    return keys.length === 1 && keys[0] === "fields" && f && typeof f === "object"
      && Object.keys(f).length === 1 && (typeof Object.values(f)[0] === "number" || Object.values(f)[0] === null);
  }
  return Object.keys(b).length === 1 && typeof b.body === "string";
}

function loadEnvFile(explicit) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = explicit ? [explicit] : [".env.local", ".env", path.join(here, ".env.local"), path.join(here, ".env")];
  for (const f of candidates) if (existsSync(f)) return { file: path.resolve(f), env: parseEnv(readFileSync(f, "utf8")) };
  if (explicit) throw new Error(`Env file not found: ${explicit}`);
  return { file: null, env: {} };
}

async function main(argv) {
  const flagOrigins = [];
  let port;
  let envFile;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--origin") flagOrigins.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--env") envFile = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node jira-helper.mjs [--origin <extra site>] [--env .env] [--port 8787]");
      console.log(`Always allowed: ${DEFAULT_ORIGINS.join(", ")}`);
      return;
    }
  }
  const { file, env: fileEnv } = loadEnvFile(envFile);
  // Real environment variables win over the file.
  const env = { ...fileEnv, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("JIRA_") || k.startsWith("HELPER_"))) };
  let jira;
  try { jira = configFromEnv(env); } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error(file ? `  (read ${file})` : "  No .env file found here — create one with JIRA_BASE_URL and JIRA_API_TOKEN, or pass --env <file>.");
    process.exit(1);
  }
  const origins = allowedOrigins(flagOrigins, env);
  port ??= Number(env.HELPER_PORT ?? 8787);
  const server = createJiraHelper({ jira, origins });
  server.listen(port, "127.0.0.1", async () => {
    console.log(`Planning Poker Jira helper on http://127.0.0.1:${port}${file ? ` (credentials from ${file})` : ""}`);
    console.log(`Allowed sites: ${origins.join(", ")}`);
    const s = await server.jiraStatus();
    console.log(s.ok ? `✓ Connected to ${jira.baseUrl} as ${s.user}. You can host rooms now. Ctrl+C to stop.` : `✗ ${s.error}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
