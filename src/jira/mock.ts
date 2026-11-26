import { JiraError } from "./client";
import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint, ListIssuesOptions } from "./types";

const BOARDS: JiraBoard[] = [
  { id: 1, name: "Demo Scrum Board", type: "scrum" },
  { id: 2, name: "Demo Kanban Board", type: "kanban" },
];

const DEMO: Omit<JiraIssue, "url" | "status" | "issueType">[] = [
  { key: "DEMO-101", summary: "User can reset their password via email", description: "As a user I want to reset my password so that I can regain access.\n\nAC: email with expiring link; old sessions invalidated.", estimate: null },
  { key: "DEMO-102", summary: "Export board as CSV", description: "Admins need a CSV export of all cards, including custom fields.", estimate: null },
  { key: "DEMO-103", summary: "Migrate notification service to the new queue", description: "Replace the legacy cron-based notifier. Unknown: ordering guarantees.", estimate: 13 },
  { key: "DEMO-104", summary: "Dark mode for the settings page", description: "Respect prefers-color-scheme.", estimate: null },
  { key: "DEMO-105", summary: "Rate-limit the public search API", description: "Token bucket per API key, 429 with Retry-After.", estimate: null },
  { key: "DEMO-106", summary: "Spike: evaluate full-text search engines", description: "Timeboxed investigation.", estimate: null },
];

/** In-memory Jira stand-in for demos (JIRA_MOCK=1) and tests. */
export class MockJira implements JiraGateway {
  readonly kind = "mock" as const;
  failWrites: string | null = null;
  readonly comments: Record<string, string[]> = {};
  private issues = new Map<string, JiraIssue>(
    DEMO.map((d) => [d.key, { ...d, status: "To Do", issueType: "Story", url: `https://jira.example.test/browse/${d.key}` }]),
  );

  async listBoards(): Promise<JiraBoard[]> {
    return BOARDS.map((b) => ({ ...b }));
  }

  async searchBoards(query: string): Promise<JiraBoard[]> {
    const q = query.trim().toLowerCase();
    return BOARDS.filter((b) => b.name.toLowerCase().includes(q)).map((b) => ({ ...b }));
  }

  async getBoard(id: number): Promise<JiraBoard> {
    const b = BOARDS.find((x) => x.id === id);
    if (!b) throw new JiraError(`Board ${id} not found`, 404);
    return { ...b };
  }

  async listSprints(boardId: number): Promise<JiraSprint[]> {
    if ((await this.getBoard(boardId)).type !== "scrum") throw new JiraError("The board does not support sprints", 400);
    return [{ id: 10, name: "Sprint 10", state: "active" }, { id: 11, name: "Sprint 11", state: "future" }];
  }

  async listIssues(_boardId: number, opts: ListIssuesOptions = {}): Promise<JiraIssue[]> {
    const all = [...this.issues.values()];
    const q = opts.query?.trim().toLowerCase();
    if (q) return all.filter((i) => i.key.toLowerCase() === q || i.summary.toLowerCase().includes(q));
    if (opts.sprintId === 10) return all.slice(0, 3);
    if (opts.sprintId === 11) return all.slice(3, 5);
    return all;
  }

  async getIssues(keys: string[]): Promise<JiraIssue[]> {
    return keys.map((k) => {
      const i = this.issues.get(k.toUpperCase());
      if (!i) throw new JiraError(`Issue ${k} not found`, 404);
      return { ...i };
    });
  }

  async writeEstimate(key: string, points: number, comment?: string): Promise<void> {
    if (this.failWrites) throw new JiraError(this.failWrites, 500);
    const i = this.issues.get(key.toUpperCase());
    if (!i) throw new JiraError(`Issue ${key} not found`, 404);
    i.estimate = points;
    if (comment) (this.comments[i.key] ??= []).push(comment);
  }
}
