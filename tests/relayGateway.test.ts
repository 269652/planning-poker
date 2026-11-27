import { describe, it, expect } from "vitest";
import type { ClientMessage } from "@/core/protocol";
import { RelayJiraGateway } from "@/jira/relayGateway";

describe("RelayJiraGateway (a PM's Jira, answered by the host)", () => {
  it("sends reads as `jira` requests and resolves them with the matching `jiraResult`", async () => {
    const sent: ClientMessage[] = [];
    const g = new RelayJiraGateway((m) => { sent.push(m); return true; });
    const boards = g.searchBoards("BMG");
    const sprints = g.listSprints(7);
    const [r1, r2] = sent as Extract<ClientMessage, { type: "jira" }>[];
    expect(r1).toMatchObject({ type: "jira", op: "searchBoards", args: ["BMG"] });
    expect(r2).toMatchObject({ op: "listSprints", args: [7] });
    expect(g.receive({ type: "jiraResult", reqId: r2.reqId, ok: false, error: "nope" })).toBe(true);
    expect(g.receive({ type: "jiraResult", reqId: r1.reqId, ok: true, data: [{ id: 1, name: "B", type: "kanban" }] })).toBe(true);
    await expect(boards).resolves.toEqual([{ id: 1, name: "B", type: "kanban" }]);
    await expect(sprints).rejects.toThrow("nope");
    expect(g.receive({ type: "pong" })).toBe(false);
  });

  it("fails right away when not connected, and on dispose", async () => {
    const offline = new RelayJiraGateway(() => false);
    await expect(offline.listBoards()).rejects.toThrow(/Not connected/);
    const g = new RelayJiraGateway(() => true);
    const pending = g.listBoards();
    g.dispose("You are no longer a PM");
    await expect(pending).rejects.toThrow("You are no longer a PM");
  });

  it("never writes to Jira", async () => {
    const g = new RelayJiraGateway(() => true);
    await expect(g.writeEstimate()).rejects.toThrow(/host/);
  });
});
