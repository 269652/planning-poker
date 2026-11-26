export interface JiraBoard { id: number; name: string; type: string }
export interface JiraSprint { id: number; name: string; state: string }
export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  /** Current story point value in Jira, if any. */
  estimate: number | null;
  url: string;
}

export interface ListIssuesOptions {
  /** Issues of one sprint (scrum boards). Ignored when `query` is set. */
  sprintId?: number;
  /** "backlog" (default; scrum only) or "all" open issues on the board (works for kanban too). */
  scope?: "backlog" | "all";
  /** Free-text / issue-key search across all open issues on the board. */
  query?: string;
}

/** What the planning poker server needs from Jira. Implemented by the real client and a mock. */
export interface JiraGateway {
  readonly kind: "jira" | "mock";
  listBoards(): Promise<JiraBoard[]>;
  /** One small page of boards whose name contains `query` (autocomplete). */
  searchBoards(query: string): Promise<JiraBoard[]>;
  getBoard(id: number): Promise<JiraBoard>;
  listSprints(boardId: number): Promise<JiraSprint[]>;
  listIssues(boardId: number, opts?: ListIssuesOptions): Promise<JiraIssue[]>;
  getIssues(keys: string[]): Promise<JiraIssue[]>;
  /** Writes the story points field and optionally adds a comment (documenting the rounds). */
  writeEstimate(key: string, points: number, comment?: string): Promise<void>;
}
