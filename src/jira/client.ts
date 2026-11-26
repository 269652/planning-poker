import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint } from "./types";

export interface JiraConfig {
  baseUrl: string;
  /** Required for "basic" auth (Jira Cloud: account email + API token). */
  email?: string;
  apiToken: string;
  /** "basic" = email:token (Cloud); "bearer" = personal access token (Server / Data Center). */
  authType: "basic" | "bearer";
  /** e.g. customfield_10016. Auto-discovered by field name when omitted. */
  storyPointsField?: string;
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class JiraClient implements JiraGateway {
  readonly kind = "jira" as const;
  private readonly base: string;
  private spField?: string;

  constructor(private readonly cfg: JiraConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = cfg.baseUrl.replace(/\/+$/, "");
    this.spField = cfg.storyPointsField;
  }

  private authHeader(): string {
    if (this.cfg.authType === "bearer") return `Bearer ${this.cfg.apiToken}`;
    return "Basic " + Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString("base64");
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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

  async listIssues(boardId: number, opts: { sprintId?: number } = {}): Promise<JiraIssue[]> {
    const field = await this.pointsField();
    const root = opts.sprintId !== undefined
      ? `/rest/agile/1.0/sprint/${this.int(opts.sprintId)}/issue`
      : `/rest/agile/1.0/board/${this.int(boardId)}/backlog`;
    const q = new URLSearchParams({
      fields: ["summary", "description", "status", "issuetype", field].join(","),
      jql: "statusCategory != Done",
      maxResults: String(PAGE),
    });
    const out: JiraIssue[] = [];
    for (let startAt = 0; ; ) {
      q.set("startAt", String(startAt));
      const page: Json = await this.request("GET", `${root}?${q}`);
      const issues: Json[] = page.issues ?? [];
      out.push(...issues.map((i) => this.toIssue(i, field)));
      startAt += issues.length;
      if (issues.length === 0 || page.isLast === true || (typeof page.total === "number" && startAt >= page.total)) break;
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
