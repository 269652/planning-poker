import { describe, it, expect, vi } from "vitest";
import { JiraClient, JiraError } from "@/jira/client";
import { formatEstimateComment } from "@/jira/comment";
import { MockJira } from "@/jira/mock";
import { Room } from "@/core/room";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(routes: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url, method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const path = url.replace("https://acme.atlassian.net", "").split("?")[0];
    const key = `${call.method} ${path}`;
    const handler = routes[key];
    if (!handler) return new Response(`no route ${key}`, { status: 404 });
    const out = handler(call);
    if (out instanceof Response) return out;
    return new Response(out === undefined ? null : JSON.stringify(out), { status: out === undefined ? 204 : 200, headers: { "content-type": "application/json" } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const cfg = { baseUrl: "https://acme.atlassian.net/", email: "me@acme.com", apiToken: "tok", authType: "basic" as const };
const fields = () => [
  { id: "customfield_10016", name: "Story point estimate" },
  { id: "summary", name: "Summary" },
];

const issueJson = (key: string, sp: number | null = null) => ({
  key, fields: { summary: `Sum ${key}`, description: "Desc", status: { name: "To Do" }, issuetype: { name: "Story" }, customfield_10016: sp },
});

describe("JiraClient", () => {
  it("uses basic auth with email:token and strips trailing slash from baseUrl", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/agile/1.0/board": () => ({ values: [{ id: 1, name: "Team", type: "scrum" }], isLast: true }) });
    const boards = await new JiraClient(cfg, fn).listBoards();
    expect(boards).toEqual([{ id: 1, name: "Team", type: "scrum" }]);
    expect(calls[0].headers.Authorization).toBe("Basic " + Buffer.from("me@acme.com:tok").toString("base64"));
    expect(calls[0].url.startsWith("https://acme.atlassian.net/rest/agile/1.0/board")).toBe(true);
  });

  it("uses bearer auth for personal access tokens", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/agile/1.0/board": () => ({ values: [], isLast: true }) });
    await new JiraClient({ baseUrl: "https://acme.atlassian.net", apiToken: "pat", authType: "bearer" }, fn).listBoards();
    expect(calls[0].headers.Authorization).toBe("Bearer pat");
  });

  it("paginates boards", async () => {
    let page = 0;
    const { fn } = fakeFetch({
      "GET /rest/agile/1.0/board": () => (page++ === 0
        ? { values: [{ id: 1, name: "A", type: "scrum" }], isLast: false }
        : { values: [{ id: 2, name: "B", type: "kanban" }], isLast: true }),
    });
    expect((await new JiraClient(cfg, fn).listBoards()).map((b) => b.id)).toEqual([1, 2]);
  });

  it("lists active and future sprints", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/agile/1.0/board/7/sprint": () => ({ values: [{ id: 11, name: "Sprint 11", state: "active" }, { id: 12, name: "Sprint 12", state: "future" }], isLast: true }),
    });
    const sprints = await new JiraClient(cfg, fn).listSprints(7);
    expect(sprints).toEqual([{ id: 11, name: "Sprint 11", state: "active" }, { id: 12, name: "Sprint 12", state: "future" }]);
    expect(decodeURIComponent(calls[0].url)).toContain("state=active,future");
  });

  it("lists backlog issues, discovering the story points field and excluding done work", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/field": fields,
      "GET /rest/agile/1.0/board/7/backlog": () => ({ issues: [issueJson("P-1", 5), issueJson("P-2")], isLast: true, total: 2 }),
    });
    const issues = await new JiraClient(cfg, fn).listIssues(7);
    expect(issues).toEqual([
      { key: "P-1", summary: "Sum P-1", description: "Desc", status: "To Do", issueType: "Story", estimate: 5, url: "https://acme.atlassian.net/browse/P-1" },
      { key: "P-2", summary: "Sum P-2", description: "Desc", status: "To Do", issueType: "Story", estimate: null, url: "https://acme.atlassian.net/browse/P-2" },
    ]);
    const u = decodeURIComponent(calls.find((c) => c.url.includes("/backlog"))!.url.replace(/\+/g, " "));
    expect(u).toContain("customfield_10016");
    expect(u).toContain("statusCategory != Done");
  });

  it("lists sprint issues when a sprintId is given", async () => {
    const { fn } = fakeFetch({
      "GET /rest/api/2/field": fields,
      "GET /rest/agile/1.0/sprint/11/issue": () => ({ issues: [issueJson("P-9")], isLast: true, total: 1 }),
    });
    expect((await new JiraClient(cfg, fn).listIssues(7, { sprintId: 11 })).map((i) => i.key)).toEqual(["P-9"]);
  });

  it("paginates issues by startAt until total is reached", async () => {
    const starts: string[] = [];
    const { fn } = fakeFetch({
      "GET /rest/api/2/field": fields,
      "GET /rest/agile/1.0/board/7/backlog": (c) => {
        const startAt = Number(new URL(c.url).searchParams.get("startAt"));
        starts.push(String(startAt));
        return startAt === 0
          ? { issues: [issueJson("P-1")], startAt: 0, maxResults: 1, total: 2 }
          : { issues: [issueJson("P-2")], startAt: 1, maxResults: 1, total: 2 };
      },
    });
    expect((await new JiraClient(cfg, fn).listIssues(7)).map((i) => i.key)).toEqual(["P-1", "P-2"]);
    expect(starts).toEqual(["0", "1"]);
  });

  it("honours an explicitly configured story points field (no discovery call)", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/issue/P-1": () => issueJson("P-1", 3),
    });
    const issues = await new JiraClient({ ...cfg, storyPointsField: "customfield_10016" }, fn).getIssues(["P-1"]);
    expect(issues[0].estimate).toBe(3);
    expect(calls.some((c) => c.url.includes("/field"))).toBe(false);
  });

  it("falls back to 'Story Points' naming when 'Story point estimate' is absent", async () => {
    const { fn } = fakeFetch({
      "GET /rest/api/2/field": () => [{ id: "customfield_10002", name: "Story Points" }],
      "GET /rest/api/2/issue/P-1": () => ({ key: "P-1", fields: { summary: "s", status: { name: "x" }, issuetype: { name: "Bug" }, customfield_10002: 8 } }),
    });
    expect((await new JiraClient(cfg, fn).getIssues(["P-1"]))[0].estimate).toBe(8);
  });

  it("errors clearly when no story points field can be found", async () => {
    const { fn } = fakeFetch({ "GET /rest/api/2/field": () => [{ id: "summary", name: "Summary" }] });
    await expect(new JiraClient(cfg, fn).writeEstimate("P-1", 5)).rejects.toThrow(/story points/i);
  });

  it("writes the estimate and an optional comment", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/field": fields,
      "PUT /rest/api/2/issue/P-1": () => undefined,
      "POST /rest/api/2/issue/P-1/comment": () => ({ id: "1" }),
    });
    await new JiraClient(cfg, fn).writeEstimate("P-1", 8, "hello");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ fields: { customfield_10016: 8 } });
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ body: "hello" });
  });

  it("does not post a comment when none is given", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/api/2/field": fields, "PUT /rest/api/2/issue/P-1": () => undefined });
    await new JiraClient(cfg, fn).writeEstimate("P-1", 8);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("keeps the estimate write even if the comment fails, but reports the failure", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/field": fields,
      "PUT /rest/api/2/issue/P-1": () => undefined,
      "POST /rest/api/2/issue/P-1/comment": () => new Response("nope", { status: 403 }),
    });
    await expect(new JiraClient(cfg, fn).writeEstimate("P-1", 8, "c")).rejects.toThrow(/comment/i);
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  it("throws JiraError with status on HTTP failure", async () => {
    const { fn } = fakeFetch({ "GET /rest/agile/1.0/board": () => new Response("unauthorized", { status: 401 }) });
    const err = await new JiraClient(cfg, fn).listBoards().catch((e) => e);
    expect(err).toBeInstanceOf(JiraError);
    expect(err.status).toBe(401);
  });

  it("rejects malformed issue keys before any request (no path injection)", async () => {
    const { fn, calls } = fakeFetch({});
    await expect(new JiraClient(cfg, fn).writeEstimate("../../admin", 3)).rejects.toThrow(/issue key/i);
    expect(calls).toHaveLength(0);
  });
});

describe("JiraClient: board search, kanban boards and issue search", () => {
  const sp = () => fields();
  const jqlOf = (c: Call) => new URL(c.url).searchParams.get("jql");

  it("searches boards by name with a single small page", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/agile/1.0/board": () => ({ values: [{ id: 3, name: "BMG Relaunch", type: "kanban" }], isLast: false }) });
    const boards = await new JiraClient(cfg, fn).searchBoards("bmg");
    expect(boards).toEqual([{ id: 3, name: "BMG Relaunch", type: "kanban" }]);
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("name")).toBe("bmg");
    expect(q.get("maxResults")).toBe("20");
  });

  it("searchBoards without a query returns the first page and omits the name filter", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/agile/1.0/board": () => ({ values: [], isLast: true }) });
    await new JiraClient(cfg, fn).searchBoards("  ");
    expect(new URL(calls[0].url).searchParams.has("name")).toBe(false);
  });

  it("fetches a single board by id", async () => {
    const { fn } = fakeFetch({ "GET /rest/agile/1.0/board/42": () => ({ id: 42, name: "Team", type: "scrum", self: "x" }) });
    expect(await new JiraClient(cfg, fn).getBoard(42)).toEqual({ id: 42, name: "Team", type: "scrum" });
  });

  it("lists all open issues on a board (kanban boards have no backlog)", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/field": sp,
      "GET /rest/agile/1.0/board/5/issue": () => ({ issues: [issueJson("K-1")], total: 1 }),
    });
    const issues = await new JiraClient(cfg, fn).listIssues(5, { scope: "all" });
    expect(issues.map((i) => i.key)).toEqual(["K-1"]);
    expect(jqlOf(calls[1])).toBe("statusCategory != Done ORDER BY Rank ASC");
  });

  it("searches issue text on the board, sanitising the query so it cannot alter the JQL", async () => {
    const { fn, calls } = fakeFetch({
      "GET /rest/api/2/field": sp,
      "GET /rest/agile/1.0/board/5/issue": () => ({ issues: [issueJson("K-2")], total: 1 }),
    });
    const issues = await new JiraClient(cfg, fn).listIssues(5, { query: 'login" OR project = (X)\\' });
    expect(issues.map((i) => i.key)).toEqual(["K-2"]);
    expect(jqlOf(calls[1])).toBe('statusCategory != Done AND text ~ "login OR project = X*" ORDER BY Rank ASC');
    expect(new URL(calls[1].url).searchParams.get("maxResults")).toBe("50");
  });

  it("a query that looks like an issue key also finds that issue directly, first and without duplicates", async () => {
    const { fn } = fakeFetch({
      "GET /rest/api/2/field": sp,
      "GET /rest/api/2/issue/K-9": () => issueJson("K-9"),
      "GET /rest/agile/1.0/board/5/issue": () => ({ issues: [issueJson("K-3"), issueJson("K-9")], total: 2 }),
    });
    const issues = await new JiraClient(cfg, fn).listIssues(5, { query: " k-9 " });
    expect(issues.map((i) => i.key)).toEqual(["K-9", "K-3"]);
  });

  it("an unknown key in the query is not an error", async () => {
    const { fn } = fakeFetch({
      "GET /rest/api/2/field": sp,
      "GET /rest/agile/1.0/board/5/issue": () => ({ issues: [], total: 0 }),
    });
    expect(await new JiraClient(cfg, fn).listIssues(5, { query: "NOPE-1" })).toEqual([]);
  });
});

describe("formatEstimateComment", () => {
  it("summarises estimate, resolution and every round without naming voters", () => {
    let n = 0;
    const room = Room.create({ id: "R", name: "Sprint 42", newId: () => `i${++n}` });
    const h = room.join({ name: "Secret Sam" }).participant.id;
    const b = room.join({ name: "Bob" }).participant.id;
    const t = room.addTicket(h, { title: "T", key: "P-1", source: "jira" });
    room.selectTicket(h, t.id);
    room.vote(h, 3); room.vote(b, 13); room.reveal(h); room.nextRound(h);
    room.vote(h, 8); room.vote(b, 8); room.reveal(h);
    const done = room.finalize(h);
    const text = formatEstimateComment(done, "Sprint 42");
    expect(text).toContain("8 story points");
    expect(text).toContain("Sprint 42");
    expect(text).toContain("agreement");
    expect(text).toMatch(/Round 1: .*3.*13/);
    expect(text).toMatch(/Round 2: .*8/);
    expect(text).not.toContain("Sam");
    expect(text).not.toContain("Bob");
  });
});

describe("JiraClient in the browser", () => {
  it("routes calls through the CORS helper when configured, but links issues to Jira itself", async () => {
    const urls: string[] = [];
    const fn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ key: "P-1", fields: { summary: "s" } }), { status: 200 });
    }) as typeof fetch;
    const c = new JiraClient({ ...cfg, storyPointsField: "customfield_1", proxyUrl: "http://127.0.0.1:8787/" }, fn);
    const [issue] = await c.getIssues(["P-1"]);
    expect(urls[0]).toBe("http://127.0.0.1:8787/rest/api/2/issue/P-1?fields=summary,description,status,issuetype,customfield_1");
    expect(issue.url).toBe("https://acme.atlassian.net/browse/P-1");
  });

  it("encodes basic auth without Node's Buffer (UTF-8 safe)", async () => {
    const { fn, calls } = fakeFetch({ "GET /rest/agile/1.0/board": () => ({ values: [], isLast: true }) });
    await new JiraClient({ ...cfg, email: "jürgen@acme.com" }, fn).listBoards();
    expect(calls[0].headers.Authorization).toBe("Basic " + Buffer.from("jürgen@acme.com:tok", "utf8").toString("base64"));
  });

  it("explains a CORS/network block instead of a bare 'Failed to fetch'", async () => {
    const fn = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    const err = await new JiraClient(cfg, fn).listBoards().catch((e) => e);
    expect(err).toBeInstanceOf(JiraError);
    expect(err.message).toMatch(/Jira helper/);
    expect(err.status).toBe(0);
  });
});

describe("MockJira", () => {
  it("serves boards/sprints/issues and records written estimates", async () => {
    const j = new MockJira();
    const boards = await j.listBoards();
    expect(boards.length).toBeGreaterThan(0);
    const issues = await j.listIssues(boards[0].id);
    expect(issues.length).toBeGreaterThan(2);
    await j.writeEstimate(issues[0].key, 5, "c");
    expect((await j.getIssues([issues[0].key]))[0].estimate).toBe(5);
    expect(j.comments[issues[0].key]).toEqual(["c"]);
  });
  it("has a scrum and a kanban board, searchable by name", async () => {
    const j = new MockJira();
    expect((await j.searchBoards("")).map((b) => b.type)).toEqual(["scrum", "kanban"]);
    expect(await j.searchBoards("kanban")).toEqual([{ id: 2, name: "Demo Kanban Board", type: "kanban" }]);
    expect(await j.getBoard(1)).toMatchObject({ name: "Demo Scrum Board" });
    await expect(j.getBoard(99)).rejects.toMatchObject({ status: 404 });
  });
  it("searches issues by key or summary", async () => {
    const j = new MockJira();
    expect((await j.listIssues(1, { query: "csv" })).map((i) => i.key)).toEqual(["DEMO-102"]);
    expect((await j.listIssues(2, { query: "demo-105" })).map((i) => i.key)).toEqual(["DEMO-105"]);
    expect(await j.listIssues(2, { scope: "all" })).toHaveLength(6);
  });
  it("can be told to fail writes", async () => {
    const j = new MockJira();
    j.failWrites = "jira down";
    await expect(j.writeEstimate("DEMO-1", 3)).rejects.toThrow("jira down");
  });
});
