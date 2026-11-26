import type { TicketInput } from '@/core/room';
import { JiraClient, type FetchIssuesParams, type JiraBoard, type JiraSprint } from './client';
import { loadJiraConfig, type JiraEnv } from './config';

/** What the room server needs from Jira. Real and mock implementations. */
export interface JiraGateway {
  readonly mode: 'real' | 'mock';
  listBoards(query?: string): Promise<JiraBoard[]>;
  listSprints(boardId: number): Promise<JiraSprint[]>;
  fetchIssues(p: FetchIssuesParams): Promise<TicketInput[]>;
  writeEstimate(key: string, points: number, commentLines: string[]): Promise<void>;
}

export class RealJiraGateway implements JiraGateway {
  readonly mode = 'real' as const;
  constructor(private client: JiraClient) {}
  listBoards(q?: string) { return this.client.listBoards(q); }
  listSprints(id: number) { return this.client.listSprints(id); }
  fetchIssues(p: FetchIssuesParams) { return this.client.fetchIssues(p); }
  writeEstimate(key: string, points: number, lines: string[]) { return this.client.writeEstimate(key, points, lines); }
}

interface DemoIssue extends TicketInput { key: string; boardId: number; sprintId?: number }

const DEMO_ISSUES: DemoIssue[] = [
  { key: 'DEMO-101', boardId: 1, sprintId: 11, title: 'Users can sign in with SSO', description: 'Support SAML SSO for enterprise tenants.\n\nAcceptance: IdP-initiated and SP-initiated login both work.', currentEstimate: null },
  { key: 'DEMO-102', boardId: 1, sprintId: 11, title: 'Export dashboard as PDF', description: 'Add an "Export PDF" button to the main dashboard.', currentEstimate: null },
  { key: 'DEMO-103', boardId: 1, sprintId: 11, title: 'Fix flaky checkout test', description: 'The checkout e2e test fails ~1 in 10 runs on CI.', currentEstimate: 2 },
  { key: 'DEMO-104', boardId: 1, sprintId: 11, title: 'Migrate notifications to the new queue', description: 'Move email + push notifications to the shared message queue.', currentEstimate: null },
  { key: 'DEMO-105', boardId: 1, sprintId: 12, title: 'Dark mode', description: 'Respect prefers-color-scheme across the app.', currentEstimate: null },
  { key: 'DEMO-106', boardId: 1, sprintId: 12, title: 'Audit log for admin actions', description: 'Persist and display who changed what.', currentEstimate: null },
  { key: 'DEMO-201', boardId: 2, title: 'Upgrade Postgres to 16', description: 'Plan and execute the upgrade with zero downtime.', currentEstimate: null },
  { key: 'DEMO-202', boardId: 2, title: 'Rotate leaked API tokens', description: 'Revoke and reissue service tokens.', currentEstimate: null },
];

/** In-memory Jira for trying the app without credentials (JIRA_MODE=mock) and for tests. */
export class MockJiraGateway implements JiraGateway {
  readonly mode = 'mock' as const;
  readonly written: { key: string; points: number; lines: string[] }[] = [];
  private issues: DemoIssue[] = structuredClone(DEMO_ISSUES);
  private boards: JiraBoard[] = [
    { id: 1, name: 'Demo Scrum Board', type: 'scrum' },
    { id: 2, name: 'Platform Kanban', type: 'kanban' },
  ];
  private sprints: Record<number, JiraSprint[]> = {
    1: [{ id: 11, name: 'Sprint 42', state: 'active' }, { id: 12, name: 'Sprint 43', state: 'future' }],
    2: [],
  };

  async listBoards(q?: string) {
    const needle = q?.toLowerCase();
    return this.boards.filter((b) => !needle || b.name.toLowerCase().includes(needle));
  }
  async listSprints(boardId: number) {
    return this.sprints[boardId] ?? [];
  }
  async fetchIssues({ boardId, sprintId }: FetchIssuesParams) {
    return this.issues
      .filter((i) => i.boardId === boardId && (!sprintId || i.sprintId === sprintId))
      .map(({ boardId: _b, sprintId: _s, ...t }) => ({ ...t, url: null, source: 'jira' as const }));
  }
  async writeEstimate(key: string, points: number, lines: string[]) {
    const issue = this.issues.find((i) => i.key === key);
    if (!issue) throw new Error(`Issue ${key} not found`);
    issue.currentEstimate = points;
    this.written.push({ key, points, lines });
  }
}

/** Build the gateway selected by the environment (null = Jira disabled). */
export function createGateway(env: JiraEnv, fetchImpl?: typeof fetch): JiraGateway | null {
  const cfg = loadJiraConfig(env);
  if (!cfg) return null;
  if (cfg.mode === 'mock') return new MockJiraGateway();
  return new RealJiraGateway(new JiraClient(cfg, fetchImpl));
}
