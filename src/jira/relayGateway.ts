import type { ClientMessage, JiraProxyOp, ServerMessage } from "@/core/protocol";
import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint, ListIssuesOptions } from "./types";

const TIMEOUT_MS = 25_000;

/**
 * Jira for a PM: every read goes as a `jira` message to the host, whose browser asks Jira through its
 * helper and answers with `jiraResult`. The PM never needs Jira access or credentials. Writing stays
 * with the host (finalizing a ticket writes the estimate from the host's tab).
 */
export class RelayJiraGateway implements JiraGateway {
  readonly kind = "jira" as const;
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  /** @param send returns false when the message could not be sent (not connected). */
  constructor(private readonly send: (m: ClientMessage) => boolean) {}

  /** Feed server messages in; answers to our requests are consumed (returns true). */
  receive(m: ServerMessage): boolean {
    if (m.type !== "jiraResult") return false;
    const p = this.pending.get(m.reqId);
    if (!p) return true;
    this.pending.delete(m.reqId);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error));
    return true;
  }

  /** Fail everything still waiting (connection lost, role removed). */
  dispose(reason = "Connection to the host lost"): void {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); this.pending.delete(id); }
  }

  private call<T>(op: JiraProxyOp, args: (string | number | Record<string, unknown>)[] = []): Promise<T> {
    const reqId = `j${++this.seq}-${Date.now().toString(36)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(reqId); reject(new Error("The host didn't answer the Jira request in time")); }, TIMEOUT_MS);
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
      if (!this.send({ type: "jira", reqId, op, args })) {
        clearTimeout(timer); this.pending.delete(reqId);
        reject(new Error("Not connected to the host"));
      }
    });
  }

  listBoards(): Promise<JiraBoard[]> { return this.call("listBoards"); }
  searchBoards(query: string): Promise<JiraBoard[]> { return this.call("searchBoards", [query]); }
  getBoard(id: number): Promise<JiraBoard> { return this.call("getBoard", [id]); }
  listSprints(boardId: number): Promise<JiraSprint[]> { return this.call("listSprints", [boardId]); }
  listIssues(boardId: number, opts: ListIssuesOptions = {}): Promise<JiraIssue[]> {
    return this.call("listIssues", [boardId, { ...opts } as Record<string, unknown>]);
  }
  /** For opening rows (descriptions shortened); the import itself goes through `importJira`. */
  async getIssues(keys: string[]): Promise<JiraIssue[]> {
    const found = await Promise.all(keys.slice(0, 5).map((k) => this.call<JiraIssue | null>("getIssue", [k])));
    return found.filter((i): i is JiraIssue => !!i);
  }
  writeEstimate(): Promise<void> { return Promise.reject(new Error("Only the host writes to Jira")); }
}
