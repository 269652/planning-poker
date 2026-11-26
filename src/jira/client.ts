import type { TicketInput } from '@/core/room';
import { adfToText, textToAdf } from './adf';
import type { RealJiraConfig } from './config';

export class JiraError extends Error {
  override name = 'JiraError';
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface JiraBoard { id: number; name: string; type: string }
export interface JiraSprint { id: number; name: string; state: string }
export interface FetchIssuesParams { boardId: number; sprintId?: number; jql?: string }

const PAGE = 50;
const MAX_PAGES = 40;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const SP_NAMES = ['story point estimate', 'story points'];

/** Thin Jira REST client (Cloud v3 / Server+DC v2 + Agile 1.0). `fetch` is injectable for tests. */
export class JiraClient {
  private spField?: Promise<string>;

  constructor(
    private cfg: RealJiraConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.spField = cfg.storyPointsField ? Promise.resolve(cfg.storyPointsField) : undefined;
  }

  async listBoards(name?: string): Promise<JiraBoard[]> {
    const out: JiraBoard[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.req<{ values: JiraBoard[]; isLast?: boolean }>('GET', '/rest/agile/1.0/board', {
        query: { startAt: out.length, maxResults: PAGE, ...(name ? { name } : {}) },
      });
      out.push(...res.values.map(({ id, name, type }) => ({ id, name, type })));
      if (res.isLast !== false || res.values.length === 0) break;
    }
    return out;
  }

  async listSprints(boardId: number): Promise<JiraSprint[]> {
    const out: JiraSprint[] = [];
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await this.req<{ values: JiraSprint[]; isLast?: boolean }>(
          'GET',
          `/rest/agile/1.0/board/${Number(boardId)}/sprint`,
          { query: { state: 'active,future', startAt: out.length, maxResults: PAGE } },
        );
        out.push(...res.values.map(({ id, name, state }) => ({ id, name, state })));
        if (res.isLast !== false || res.values.length === 0) break;
      }
    } catch (e) {
      if (e instanceof JiraError && e.status === 400) return []; // Kanban boards have no sprints
      throw e;
    }
    return out;
  }

  async fetchIssues(p: FetchIssuesParams): Promise<TicketInput[]> {
    const sp = await this.storyPointsField();
    const path = p.sprintId
      ? `/rest/agile/1.0/sprint/${Number(p.sprintId)}/issue`
      : `/rest/agile/1.0/board/${Number(p.boardId)}/issue`;
    const out: TicketInput[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.req<{ issues: any[]; total: number }>('GET', path, {
        query: {
          jql: p.jql?.trim() || this.cfg.defaultJql,
          fields: `summary,description,${sp}`,
          startAt: out.length,
          maxResults: PAGE,
        },
      });
      for (const i of res.issues) out.push(this.toTicket(i, sp));
      if (res.issues.length === 0 || out.length >= res.total) break;
    }
    return out;
  }

  /** Resolve (and cache) the custom field that holds story points. */
  storyPointsField(): Promise<string> {
    this.spField ??= this.detectStoryPointsField();
    this.spField.catch(() => (this.spField = undefined)); // retry next time after a failure
    return this.spField;
  }

  /**
   * Write the agreed estimate and a summary comment. The estimate is written
   * first; a failing comment is reported as a partial failure.
   */
  async writeEstimate(key: string, points: number, commentLines: string[]): Promise<void> {
    if (!ISSUE_KEY.test(key)) throw new JiraError(0, `Invalid issue key "${key}"`);
    if (!Number.isFinite(points) || points < 0) throw new JiraError(0, `Invalid estimate "${points}"`);
    const sp = await this.storyPointsField();
    const base = `/rest/api/${this.cfg.apiVersion}/issue/${encodeURIComponent(key)}`;
    await this.req('PUT', base, { body: { fields: { [sp]: points } } });
    if (commentLines.length === 0) return;
    const text = commentLines.join('\n');
    const body = this.cfg.apiVersion === 3 ? textToAdf(text) : text;
    try {
      await this.req('POST', `${base}/comment`, { body: { body } });
    } catch (e) {
      if (e instanceof JiraError) throw new JiraError(e.status, `Estimate was saved, but adding the comment failed: ${e.message}`);
      throw e;
    }
  }

  // ------------------------------------------------------------------ internals

  private async detectStoryPointsField(): Promise<string> {
    const fields = await this.req<{ id: string; name: string; schema?: { type?: string } }[]>(
      'GET',
      `/rest/api/${this.cfg.apiVersion}/field`,
    );
    for (const wanted of SP_NAMES) {
      const hit = fields.find((f) => f.name.toLowerCase() === wanted && (!f.schema?.type || f.schema.type === 'number'));
      if (hit) return hit.id;
    }
    throw new JiraError(0, 'Could not find a story points field; set JIRA_STORY_POINTS_FIELD (e.g. customfield_10016)');
  }

  private toTicket(issue: any, spField: string): TicketInput {
    const f = issue.fields ?? {};
    const sp = f[spField];
    return {
      key: issue.key,
      title: f.summary ?? issue.key,
      description: adfToText(f.description),
      url: `${this.cfg.baseUrl}/browse/${issue.key}`,
      source: 'jira',
      currentEstimate: typeof sp === 'number' ? sp : null,
    };
  }

  private authHeader(): string {
    const a = this.cfg.auth;
    return a.kind === 'basic'
      ? 'Basic ' + Buffer.from(`${a.email}:${a.token}`).toString('base64')
      : `Bearer ${a.token}`;
  }

  private async req<T = unknown>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new JiraError(0, `Could not reach Jira: ${(e as Error).message}`);
    }
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) throw new JiraError(res.status, describeError(res.status, res.statusText, json));
    return json as T;
  }
}

function describeError(status: number, statusText: string, json: any): string {
  const parts: string[] = [];
  if (Array.isArray(json?.errorMessages)) parts.push(...json.errorMessages);
  if (json?.errors && typeof json.errors === 'object') parts.push(...Object.values<string>(json.errors).map(String));
  if (typeof json?.message === 'string') parts.push(json.message);
  let msg = `Jira ${status}: ${parts.join('; ') || statusText || 'request failed'}`;
  if (status === 401) msg += ' (check your Jira credentials: JIRA_EMAIL/JIRA_API_TOKEN or JIRA_PAT)';
  if (status === 403) msg += ' (the Jira user lacks permission)';
  return msg;
}
