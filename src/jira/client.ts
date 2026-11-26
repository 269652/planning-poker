import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint, ListIssuesOptions } from "./types";

export interface JiraConfig {
  baseUrl: string;
  /** Required for "basic" auth (Jira Cloud: account email + API token). */
  email?: string;
  apiToken?: string;
  /**
   * "basic" = email:token (Cloud); "bearer" = personal access token (Server / Data Center);
   * "none" = no credentials from this side (the local Jira helper adds them).
   */
  authType: "basic" | "bearer" | "none";
  /** e.g. customfield_10016. Auto-discovered by field name when omitted. */
  storyPointsField?: string;
  /**
   * Local Jira helper (public/jira-helper.mjs). When set, REST calls go to `<proxyUrl>/rest/…`
   * and the helper forwards them to Jira; issue links still point at `baseUrl`.
   */
  proxyUrl?: string;
}

/** UTF-8 safe base64 without Node's Buffer (this client runs in the browser). */
function base64(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class JiraError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "JiraError";
  }
}

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const POINT_FIELD_NAMES = ["story point estimate", "story points"];
const PAGE = 100;
const BOARD_SEARCH_LIMIT = 20;
const SEARCH_LIMIT = 50;
/** Safety cap for "all open issues" on very large boards. */
const MAX_LISTED_ISSUES = 500;

/**
 * Reduces user input to plain search terms for a JQL `text ~ "…"` clause: quotes and backslashes
 * (which could end the JQL string) and Lucene operators are removed.
 */
export function sanitizeSearchText(input: string): string {
  return input.replace(/["\\+\-&|!(){}[\]^~*?:/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class JiraClient implements JiraGateway {
  readonly kind = "jira" as const;
  private readonly base: string;
  private readonly endpoint: string;
  private spField?: string;

  constructor(private readonly cfg: JiraConfig, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.base = cfg.baseUrl.replace(/\/+$/, "");
    this.endpoint = cfg.proxyUrl ? cfg.proxyUrl.replace(/\/+$/, "") : this.base;
    this.spField = cfg.storyPointsField;
  }

  private authHeader(): Record<string, string> {
    if (this.cfg.authType === "none") return {};
    if (this.cfg.authType === "bearer") return { Authorization: `Bearer ${this.cfg.apiToken}` };
    return { Authorization: "Basic " + base64(`${this.cfg.email}:${this.cfg.apiToken}`) };
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint + path, {
        method,
        headers: {
          ...this.authHeader(),
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Browsers report a CORS block as a bare network error.
      throw new JiraError(
        this.cfg.proxyUrl
          ? `Could not reach the Jira helper at ${this.endpoint} — is it still running? (${(e as Error).message})`
          : `Could not reach Jira from the browser — it is offline or blocks other sites (CORS). Use the local Jira helper. (${(e as Error).message})`,
        0,
      );
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new JiraError(`Jira ${method} ${path.split("?")[0]} failed: ${res.status} ${text}`.trim(), res.status);
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  private async pointsField(): Promise<string> {
    if (this.spField) return this.spField;
    const fields: { id: string; name: string }[] = await this.request("GET", "/rest/api/2/field");
    for (const wanted of POINT_FIELD_NAMES) {
      const hit = fields.find((f) => f.name.toLowerCase() === wanted);
      if (hit) return (this.spField = hit.id);
    }
    throw new JiraError("Could not find a Story Points field in Jira; set JIRA_STORY_POINTS_FIELD (e.g. customfield_10016)");
  }

  async listBoards(): Promise<JiraBoard[]> {
    const out: JiraBoard[] = [];
    for (let startAt = 0; ; ) {
      const page: Json = await this.request("GET", `/rest/agile/1.0/board?maxResults=${PAGE}&startAt=${startAt}`);
      const values: Json[] = page.values ?? [];
      out.push(...values.map((b) => ({ id: b.id, name: b.name, type: b.type })));
      if (page.isLast !== false || values.length === 0) break;
      startAt += values.length;
    }
    return out;
  }

  async searchBoards(query: string): Promise<JiraBoard[]> {
    const q = new URLSearchParams({ maxResults: String(BOARD_SEARCH_LIMIT) });
    if (query.trim()) q.set("name", query.trim().slice(0, 100));
    const page: Json = await this.request("GET", `/rest/agile/1.0/board?${q}`);
    return ((page.values ?? []) as Json[]).map((b) => ({ id: b.id, name: b.name, type: b.type }));
  }

  async getBoard(id: number): Promise<JiraBoard> {
    const b: Json = await this.request("GET", `/rest/agile/1.0/board/${this.int(id)}`);
    return { id: b.id, name: b.name, type: b.type };
  }

  async listSprints(boardId: number): Promise<JiraSprint[]> {
    const id = this.int(boardId);
    const out: JiraSprint[] = [];
    for (let startAt = 0; ; ) {
      const page: Json = await this.request("GET", `/rest/agile/1.0/board/${id}/sprint?state=active,future&maxResults=${PAGE}&startAt=${startAt}`);
      const values: Json[] = page.values ?? [];
      out.push(...values.map((s) => ({ id: s.id, name: s.name, state: s.state })));
      if (page.isLast !== false || values.length === 0) break;
      startAt += values.length;
    }
    return out;
  }

  async listIssues(boardId: number, opts: ListIssuesOptions = {}): Promise<JiraIssue[]> {
    const field = await this.pointsField();
    const query = opts.query?.trim() ?? "";
    let root: string;
    let jql = "statusCategory != Done";
    let limit = MAX_LISTED_ISSUES;
    if (query) {
      // Backlog/sprint endpoints only exist on scrum boards; the board issue endpoint works everywhere.
      root = `/rest/agile/1.0/board/${this.int(boardId)}/issue`;
      const terms = sanitizeSearchText(query);
      jql += terms ? ` AND text ~ "${terms}*" ORDER BY Rank ASC` : " ORDER BY Rank ASC";
      limit = SEARCH_LIMIT;
    } else if (opts.sprintId !== undefined) {
      root = `/rest/agile/1.0/sprint/${this.int(opts.sprintId)}/issue`;
    } else if (opts.scope === "all") {
      root = `/rest/agile/1.0/board/${this.int(boardId)}/issue`;
      jql += " ORDER BY Rank ASC";
    } else {
      root = `/rest/agile/1.0/board/${this.int(boardId)}/backlog`;
    }

    const out: JiraIssue[] = [];
    if (query && KEY.test(query)) {
      // Exact key lookups bypass the text index; an unknown key simply yields no hit.
      try {
        out.push(...(await this.getIssues([query.toUpperCase()])));
      } catch (e) {
        if (!(e instanceof JiraError) || e.status !== 404) throw e;
      }
    }

    const q = new URLSearchParams({
      fields: ["summary", "description", "status", "issuetype", field].join(","),
      jql,
      maxResults: String(Math.min(PAGE, limit)),
    });
    for (let startAt = 0, fetched = 0; fetched < limit; ) {
      q.set("startAt", String(startAt));
      const page: Json = await this.request("GET", `${root}?${q}`);
      const issues: Json[] = page.issues ?? [];
      for (const i of issues) if (!out.some((o) => o.key === i.key)) out.push(this.toIssue(i, field));
      startAt += issues.length;
      fetched += issues.length;
      if (query || issues.length === 0 || page.isLast === true || (typeof page.total === "number" && startAt >= page.total)) break;
    }
    return out;
  }

  async getIssues(keys: string[]): Promise<JiraIssue[]> {
    const field = await this.pointsField();
    const out: JiraIssue[] = [];
    for (const key of keys) {
      this.assertKey(key);
      const fields = ["summary", "description", "status", "issuetype", field].join(",");
      out.push(this.toIssue(await this.request("GET", `/rest/api/2/issue/${key}?fields=${fields}`), field));
    }
    return out;
  }

  async writeEstimate(key: string, points: number, comment?: string): Promise<void> {
    this.assertKey(key);
    const field = await this.pointsField();
    await this.request("PUT", `/rest/api/2/issue/${key}`, { fields: { [field]: points } });
    if (comment) {
      try {
        await this.request("POST", `/rest/api/2/issue/${key}/comment`, { body: comment });
      } catch (e) {
        throw new JiraError(`Estimate saved, but adding the comment failed: ${(e as Error).message}`, (e as JiraError).status);
      }
    }
  }

  private toIssue(i: Json, field: string): JiraIssue {
    const f: Json = i.fields ?? {};
    const raw = f[field];
    return {
      key: i.key,
      summary: f.summary ?? "",
      description: typeof f.description === "string" ? f.description : "",
      status: f.status?.name ?? "",
      issueType: f.issuetype?.name ?? "",
      estimate: typeof raw === "number" ? raw : null,
      url: `${this.base}/browse/${i.key}`,
    };
  }

  private assertKey(key: string): void {
    if (!KEY.test(key)) throw new JiraError(`Invalid issue key: ${key}`);
  }

  private int(n: number): number {
    if (!Number.isInteger(n) || n < 0) throw new JiraError(`Invalid id: ${n}`);
    return n;
  }
}
