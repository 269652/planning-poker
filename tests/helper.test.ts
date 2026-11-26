import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
// The helper is a dependency-free Node script, also served from the site for download.
import { createJiraHelper, parseEnv, configFromEnv, allowedOrigins, DEFAULT_ORIGINS } from "../public/jira-helper.mjs";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); });

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

async function setup(opts: { status?: number } = {}) {
  const seen: Seen[] = [];
  const jira = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    if (opts.status) { res.writeHead(opts.status, { "content-type": "application/json" }); res.end('{"errorMessages":["nope"]}'); return; }
    res.writeHead(200, { "content-type": "application/json", "set-cookie": "JSESSIONID=secret" });
    res.end(JSON.stringify(req.url!.endsWith("/myself") ? { displayName: "Moritz R", name: "morrossl" } : { ok: true, path: req.url }));
  });
  const jiraUrl = `${await listen(jira)}/jira`;
  const helper = await listen(createJiraHelper({
    jira: { baseUrl: jiraUrl, token: "secret-pat", auth: "bearer", storyPointsField: "customfield_10022" },
    origins: ["https://me.github.io"],
  }));
  return { seen, helper, jiraUrl };
}

const ORIGIN = { origin: "https://me.github.io" };

describe("parseEnv / configFromEnv (the helper reads credentials from .env; the browser never sees them)", () => {
  it("parses .env text: CRLF, export, quotes, comments, no trailing newline", () => {
    expect(parseEnv('# c\r\nexport A="x y"\r\nB=\'t#1\'  # note\r\nC=plain # tail\r\nD=a=b')).toEqual({ A: "x y", B: "t#1", C: "plain", D: "a=b" });
  });

  it("accepts the documented names and common aliases", () => {
    expect(configFromEnv({ JIRA_URL: "https://j.example/jira/", JIRA_PERSONAL_TOKEN: "pat", JIRA_USERNAME: "me" }))
      .toEqual({ baseUrl: "https://j.example/jira", token: "pat", auth: "bearer", email: "me", storyPointsField: undefined });
    expect(configFromEnv({ JIRA_BASE_URL: "https://a.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t" }))
      .toMatchObject({ auth: "basic", email: "a@b.c" });
    expect(configFromEnv({ JIRA_BASE_URL: "https://j", JIRA_API_TOKEN: "t", JIRA_AUTH: "bearer", JIRA_STORY_POINTS_FIELD: "customfield_1" }))
      .toMatchObject({ auth: "bearer", storyPointsField: "customfield_1" });
  });

  it("explains what is missing", () => {
    expect(() => configFromEnv({})).toThrow(/JIRA_BASE_URL/);
    expect(() => configFromEnv({ JIRA_BASE_URL: "https://j" })).toThrow(/JIRA_API_TOKEN/);
    expect(() => configFromEnv({ JIRA_BASE_URL: "https://j", JIRA_API_TOKEN: "t", JIRA_AUTH: "basic" })).toThrow(/JIRA_EMAIL/);
    expect(() => configFromEnv({ JIRA_BASE_URL: "ftp://j", JIRA_API_TOKEN: "t", JIRA_AUTH: "bearer" })).toThrow(/http/);
  });
});

describe("allowedOrigins (which sites may use the helper)", () => {
  it("allows this project's deployments and local development by default — exact origins only", () => {
    expect(DEFAULT_ORIGINS).toEqual([
      "https://planning-poker-psi-five.vercel.app", "https://269652.github.io", "http://localhost:3000", "http://localhost:4173",
    ]);
    expect(allowedOrigins([], {})).toEqual(DEFAULT_ORIGINS);
    expect(DEFAULT_ORIGINS.some((o: string) => o.includes("*"))).toBe(false);
  });

  it("adds --origin flags and HELPER_ORIGINS, normalised and without duplicates", () => {
    expect(allowedOrigins(["https://team.example/", "https://269652.github.io"], { HELPER_ORIGINS: " https://other.example , " }))
      .toEqual([...DEFAULT_ORIGINS, "https://team.example", "https://other.example"]);
  });
});

describe("jira-helper", () => {
  it("/status reports the Jira connection (user, Jira URL, points field) without credentials", async () => {
    const { helper, jiraUrl } = await setup();
    const r = await fetch(`${helper}/status`, { headers: ORIGIN });
    expect(r.headers.get("access-control-allow-origin")).toBe("https://me.github.io");
    const body = await r.json();
    expect(body).toEqual({ ok: true, user: "Moritz R", jiraUrl, storyPointsField: "customfield_10022" });
    expect(JSON.stringify(body)).not.toContain("secret-pat");
  });

  it("/status reports Jira rejecting the credentials", async () => {
    const { helper } = await setup({ status: 401 });
    const body = await (await fetch(`${helper}/status`, { headers: ORIGIN })).json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/401/);
  });

  it("forwards the app's Jira calls with the helper's own credentials (browser auth is ignored)", async () => {
    const { seen, helper } = await setup();
    const r = await fetch(`${helper}/rest/agile/1.0/board?maxResults=20&name=bmg`, { headers: { ...ORIGIN, authorization: "Bearer from-browser" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, path: "/jira/rest/agile/1.0/board?maxResults=20&name=bmg" });
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(seen[0].headers.authorization).toBe("Bearer secret-pat");
    expect(seen[0].headers.origin).toBeUndefined();
    expect(seen[0].headers["x-atlassian-token"]).toBe("no-check");
  });

  it("forwards estimate writes and comments with their bodies", async () => {
    const { seen, helper } = await setup();
    const json = { ...ORIGIN, "content-type": "application/json" };
    await fetch(`${helper}/rest/api/2/issue/BMG-1`, { method: "PUT", headers: json, body: '{"fields":{"customfield_10022":5}}' });
    await fetch(`${helper}/rest/api/2/issue/BMG-1/comment`, { method: "POST", headers: json, body: '{"body":"hi"}' });
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ["PUT", "/jira/rest/api/2/issue/BMG-1", '{"fields":{"customfield_10022":5}}'],
      ["POST", "/jira/rest/api/2/issue/BMG-1/comment", '{"body":"hi"}'],
    ]);
  });

  it("only forwards the endpoints the app needs (it acts as the Jira user)", async () => {
    const { seen, helper } = await setup();
    const calls: [string, string][] = [
      ["DELETE", "/rest/api/2/issue/BMG-1"],
      ["POST", "/rest/api/2/issue"],
      ["GET", "/rest/api/2/user?username=x"],
      ["PUT", "/rest/api/2/issue/BMG-1/assignee"],
      ["GET", "/secure/Dashboard.jspa"],
      ["GET", "/rest/api/2/issue/BMG-1/../../user"],
    ];
    for (const [method, path] of calls) {
      expect((await fetch(`${helper}${path}`, { method, headers: ORIGIN })).status, `${method} ${path}`).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("answers preflights itself, including Private Network Access", async () => {
    const { seen, helper } = await setup();
    const r = await fetch(`${helper}/rest/api/2/issue/BMG-1`, {
      method: "OPTIONS",
      headers: { ...ORIGIN, "access-control-request-method": "PUT", "access-control-request-headers": "content-type", "access-control-request-private-network": "true" },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(r.headers.get("access-control-allow-private-network")).toBe("true");
    expect(seen).toHaveLength(0);
  });

  it("refuses every other origin, including requests without one", async () => {
    const { seen, helper } = await setup();
    expect((await fetch(`${helper}/rest/agile/1.0/board`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${helper}/status`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${helper}/rest/agile/1.0/board`)).status).toBe(403);
    expect(seen).toHaveLength(0);
  });
});
