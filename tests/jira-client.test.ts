import { describe, expect, it } from 'vitest';
import { JiraClient, JiraError } from '@/jira/client';
import type { RealJiraConfig } from '@/jira/config';

interface Call { url: URL; method: string; headers: Record<string, string>; body: any }

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: any, init: any = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => r.json ?? {},
      text: async () => (r.json === undefined ? '' : JSON.stringify(r.json)),
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

const cloud: RealJiraConfig = {
  mode: 'real',
  baseUrl: 'https://acme.atlassian.net',
  auth: { kind: 'basic', email: 'me@acme.io', token: 'sekret' },
  apiVersion: 3,
  storyPointsField: 'customfield_10016',
  defaultJql: 'statusCategory != Done',
};

describe('JiraClient auth', () => {
  it('sends basic auth for Cloud', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: { values: [], isLast: true } }));
    await new JiraClient(cloud, impl).listBoards();
    expect(calls[0].headers.authorization).toBe('Basic ' + Buffer.from('me@acme.io:sekret').toString('base64'));
    expect(calls[0].headers.accept).toBe('application/json');
  });

  it('sends bearer auth for PATs', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: { values: [], isLast: true } }));
    await new JiraClient({ ...cloud, auth: { kind: 'bearer', token: 'pat' } }, impl).listBoards();
    expect(calls[0].headers.authorization).toBe('Bearer pat');
  });
});

describe('boards and sprints', () => {
  it('lists boards across pages', async () => {
    const { impl, calls } = fakeFetch((c) => {
      const start = Number(c.url.searchParams.get('startAt'));
      return start === 0
        ? { json: { values: [{ id: 1, name: 'Alpha', type: 'scrum' }], isLast: false } }
        : { json: { values: [{ id: 2, name: 'Beta', type: 'kanban' }], isLast: true } };
    });
    const boards = await new JiraClient(cloud, impl).listBoards('al');
    expect(boards).toEqual([
      { id: 1, name: 'Alpha', type: 'scrum' },
      { id: 2, name: 'Beta', type: 'kanban' },
    ]);
    expect(calls[0].url.pathname).toBe('/rest/agile/1.0/board');
    expect(calls[0].url.searchParams.get('name')).toBe('al');
  });

  it('lists active and future sprints, and returns [] for boards without sprints', async () => {
    const ok = fakeFetch(() => ({ json: { values: [{ id: 9, name: 'S9', state: 'active' }], isLast: true } }));
    expect(await new JiraClient(cloud, ok.impl).listSprints(7)).toEqual([{ id: 9, name: 'S9', state: 'active' }]);
    expect(ok.calls[0].url.pathname).toBe('/rest/agile/1.0/board/7/sprint');
    expect(ok.calls[0].url.searchParams.get('state')).toBe('active,future');

    const kanban = fakeFetch(() => ({ status: 400, json: { errorMessages: ['The board does not support sprints'] } }));
    expect(await new JiraClient(cloud, kanban.impl).listSprints(3)).toEqual([]);
  });
});

describe('fetchIssues', () => {
  const issue = (key: string, desc: unknown, sp: number | null = null) => ({
    key,
    fields: { summary: `Summary ${key}`, description: desc, customfield_10016: sp },
  });

  it('pages through board issues and maps them to tickets', async () => {
    const { impl, calls } = fakeFetch((c) => {
      const start = Number(c.url.searchParams.get('startAt'));
      return start === 0
        ? { json: { startAt: 0, total: 3, issues: [issue('PP-1', 'text', 3), issue('PP-2', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'adf' }] }] })] } }
        : { json: { startAt: 2, total: 3, issues: [issue('PP-3', null)] } };
    });
    const out = await new JiraClient(cloud, impl).fetchIssues({ boardId: 5 });
    expect(out.map((t) => t.key)).toEqual(['PP-1', 'PP-2', 'PP-3']);
    expect(out[0]).toEqual({
      key: 'PP-1',
      title: 'Summary PP-1',
      description: 'text',
      url: 'https://acme.atlassian.net/browse/PP-1',
      source: 'jira',
      currentEstimate: 3,
    });
    expect(out[1].description).toBe('adf');
    expect(out[2]).toMatchObject({ description: '', currentEstimate: null });
    expect(calls[0].url.pathname).toBe('/rest/agile/1.0/board/5/issue');
    expect(calls[0].url.searchParams.get('jql')).toBe('statusCategory != Done');
    expect(calls[0].url.searchParams.get('fields')).toBe('summary,description,customfield_10016');
  });

  it('uses the sprint endpoint and a custom JQL when given', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: { startAt: 0, total: 0, issues: [] } }));
    await new JiraClient(cloud, impl).fetchIssues({ boardId: 5, sprintId: 12, jql: 'type = Story' });
    expect(calls[0].url.pathname).toBe('/rest/agile/1.0/sprint/12/issue');
    expect(calls[0].url.searchParams.get('jql')).toBe('type = Story');
  });

  it('stops on an empty page even if total lies', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: { startAt: 0, total: 99, issues: [] } }));
    expect(await new JiraClient(cloud, impl).fetchIssues({ boardId: 1 })).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('story points field', () => {
  it('auto-detects the field by name when not configured and caches it', async () => {
    const { impl, calls } = fakeFetch((c) =>
      c.url.pathname.endsWith('/field')
        ? { json: [{ id: 'customfield_1', name: 'Story Points', schema: { type: 'number' } }, { id: 'customfield_2', name: 'Story point estimate', schema: { type: 'number' } }] }
        : { json: { startAt: 0, total: 0, issues: [] } },
    );
    const client = new JiraClient({ ...cloud, storyPointsField: undefined }, impl);
    expect(await client.storyPointsField()).toBe('customfield_2');
    await client.fetchIssues({ boardId: 1 });
    expect(calls.filter((c) => c.url.pathname === '/rest/api/3/field')).toHaveLength(1);
    expect(calls.find((c) => c.url.pathname.includes('/issue'))!.url.searchParams.get('fields')).toContain('customfield_2');
  });

  it('errors helpfully when no field can be found', async () => {
    const { impl } = fakeFetch(() => ({ json: [{ id: 'summary', name: 'Summary', schema: { type: 'string' } }] }));
    await expect(new JiraClient({ ...cloud, storyPointsField: undefined }, impl).storyPointsField()).rejects.toThrow(/JIRA_STORY_POINTS_FIELD/);
  });
});

describe('writeEstimate', () => {
  it('sets story points and adds an ADF comment on Cloud (v3)', async () => {
    const { impl, calls } = fakeFetch((c) => (c.method === 'PUT' ? { status: 204 } : { status: 201, json: { id: '1' } }));
    await new JiraClient(cloud, impl).writeEstimate('PP-7', 5, ['Agreed 5', 'Round 1: a 5']);
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { fields: { customfield_10016: 5 } } });
    expect(calls[0].url.pathname).toBe('/rest/api/3/issue/PP-7');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url.pathname).toBe('/rest/api/3/issue/PP-7/comment');
    expect(calls[1].body.body.type).toBe('doc');
  });

  it('uses plain-text comments on REST v2', async () => {
    const { impl, calls } = fakeFetch((c) => (c.method === 'PUT' ? { status: 204 } : { status: 201, json: {} }));
    await new JiraClient({ ...cloud, apiVersion: 2 }, impl).writeEstimate('PP-7', 0, ['Agreed 0']);
    expect(calls[0].body).toEqual({ fields: { customfield_10016: 0 } });
    expect(calls[1].body).toEqual({ body: 'Agreed 0' });
    expect(calls[1].url.pathname).toBe('/rest/api/2/issue/PP-7/comment');
  });

  it('skips the comment when there are no lines', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 204 }));
    await new JiraClient(cloud, impl).writeEstimate('PP-7', 3, []);
    expect(calls).toHaveLength(1);
  });

  it('reports a partial failure when the estimate saved but the comment did not', async () => {
    const { impl } = fakeFetch((c) => (c.method === 'PUT' ? { status: 204 } : { status: 403, json: { errorMessages: ['no comment permission'] } }));
    await expect(new JiraClient(cloud, impl).writeEstimate('PP-7', 3, ['x'])).rejects.toThrow(/Estimate was saved.*no comment permission/);
  });

  it('rejects invalid keys and non-numeric estimates before calling Jira', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 204 }));
    const c = new JiraClient(cloud, impl);
    await expect(c.writeEstimate('../../etc', 3, [])).rejects.toThrow(/issue key/i);
    await expect(c.writeEstimate('PP-1', Number.NaN, [])).rejects.toThrow(/estimate/i);
    expect(calls).toHaveLength(0);
  });
});

describe('errors', () => {
  it('surfaces Jira error messages with the status code', async () => {
    const { impl } = fakeFetch(() => ({ status: 404, json: { errorMessages: ['Issue does not exist'] } }));
    await expect(new JiraClient(cloud, impl).writeEstimate('PP-404', 1, [])).rejects.toMatchObject({
      name: 'JiraError',
      status: 404,
      message: expect.stringContaining('Issue does not exist'),
    });
  });

  it('adds a credentials hint on 401 without leaking the token', async () => {
    const { impl } = fakeFetch(() => ({ status: 401 }));
    const err = await new JiraClient(cloud, impl).listBoards().catch((e) => e);
    expect(err).toBeInstanceOf(JiraError);
    expect(err.message).toMatch(/credentials/i);
    expect(err.message).not.toContain('sekret');
  });

  it('wraps network failures', async () => {
    const { impl } = fakeFetch(() => new Error('ECONNREFUSED'));
    await expect(new JiraClient(cloud, impl).listBoards()).rejects.toMatchObject({ status: 0, message: expect.stringContaining('ECONNREFUSED') });
  });

  it('flattens field-level errors', async () => {
    const { impl } = fakeFetch(() => ({ status: 400, json: { errors: { customfield_10016: 'Field cannot be set' } } }));
    await expect(new JiraClient(cloud, impl).writeEstimate('PP-1', 1, [])).rejects.toThrow(/Field cannot be set/);
  });
});
