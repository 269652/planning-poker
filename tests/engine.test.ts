import { describe, it, expect, beforeEach } from "vitest";
import { Room, type RoomView } from "@/core/room";
import type { ClientMessage, ServerMessage } from "@/core/protocol";
import { HostEngine, type PeerLink } from "@/host/engine";
import { MockJira } from "@/jira/mock";

/** A participant connected to the host engine through an in-memory link (stands in for a WebRTC data channel). */
class TestPeer {
  messages: ServerMessage[] = [];
  view?: RoomView;
  token?: string;
  you?: string;
  errors: { code: string; message: string }[] = [];
  link: PeerLink;
  constructor(engine: HostEngine) {
    this.link = engine.connect((m) => {
      this.messages.push(m);
      if (m.type === "welcome") { this.token = m.token; this.you = m.you; }
      if (m.type === "state") this.view = m.room;
      if (m.type === "error") this.errors.push(m);
    });
  }
  send(m: ClientMessage | Record<string, unknown>) { return this.link.receive(JSON.stringify(m)); }
  get wire() { return JSON.stringify(this.messages); }
}

let jira: MockJira;
let engine: HostEngine;
let changes: number;

beforeEach(() => {
  jira = new MockJira();
  changes = 0;
  engine = new HostEngine({ room: Room.create({ id: "ROOM2345", name: "Sprint 42" }), jira, onChange: () => changes++ });
});

async function join(name: string, extra: Record<string, unknown> = {}) {
  const p = new TestPeer(engine);
  await p.send({ type: "join", roomId: "ROOM2345", name, ...extra });
  return p;
}

async function estimate(host: TestPeer, bob: TestPeer, card: 5 | 8) {
  await host.send({ type: "vote", card });
  await bob.send({ type: "vote", card });
  await host.send({ type: "reveal" });
  await host.send({ type: "finalize" });
}

describe("HostEngine: presence (closing the tab leaves the room)", () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000_000;
    engine = new HostEngine({ room: Room.create({ id: "ROOM2345", name: "Sprint 42" }), jira, now: () => now });
  });
  const who = (p: TestPeer) => p.view!.participants.filter((x) => x.connected).map((x) => x.name);

  it("'leave' (tab closing) takes a guest out right away; any later message brings them back", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    await bob.send({ type: "leave" });
    expect(who(host)).toEqual(["Host"]);
    await bob.send({ type: "ping" }); // e.g. the page came back from the back/forward cache
    expect(who(host)).toEqual(["Host", "Bob"]);
  });

  it("a reload says goodbye and joins again with the token: same person, vote kept", async () => {
    const host = await join("Host");
    await host.send({ type: "addTicket", title: "T" });
    await host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    const bob = await join("Bob");
    await bob.send({ type: "vote", card: 5 });
    await bob.send({ type: "leave" });
    bob.link.close();
    const again = await join("Bob", { token: bob.token });
    expect(again.you).toBe(bob.you);
    expect(who(host)).toEqual(["Host", "Bob"]);
    expect(host.view!.tickets[0].rounds[0].voted).toContain(bob.you);
  });

  it("a guest whose heartbeat stops is gone after 45 s; clients without heartbeats are never swept", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    await bob.send({ type: "ping" }); // sends heartbeats
    const old = await join("Olga"); // an older client: never pings
    now += 30_000; engine.sweep();
    expect(who(host)).toEqual(["Host", "Bob", "Olga"]);
    await bob.send({ type: "ping" });
    now += 40_000; engine.sweep();
    expect(who(host)).toEqual(["Host", "Bob", "Olga"]);
    now += 10_000; engine.sweep();
    expect(who(host)).toEqual(["Host", "Olga"]);
    await bob.send({ type: "vote", card: 3 }).catch(() => {});
    expect(who(host)).toEqual(["Host", "Bob", "Olga"]);
    expect(old.view).toBeDefined();
  });

  it("someone with two tabs stays while one of them is still open", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    const bob2 = await join("Bob", { token: bob.token });
    await bob.send({ type: "leave" });
    expect(who(host)).toEqual(["Host", "Bob"]);
    await bob2.send({ type: "leave" });
    expect(who(host)).toEqual(["Host"]);
  });
});

describe("HostEngine: PM role (moderates and uses Jira through the host)", () => {
  async function setup() {
    const host = await join("Host");
    const pm = await join("Paula");
    const bob = await join("Bob");
    return { host, pm, bob };
  }
  const results = (p: TestPeer) => p.messages.filter((m) => m.type === "jiraResult") as Extract<ServerMessage, { type: "jiraResult" }>[];

  it("only the host appoints PMs; everyone sees the role", async () => {
    const { host, pm, bob } = await setup();
    await bob.send({ type: "setModerator", participantId: pm.you!, moderator: true });
    expect(bob.errors.at(-1)?.code).toBe("FORBIDDEN");
    await host.send({ type: "setModerator", participantId: pm.you!, moderator: true });
    expect(bob.view!.participants.find((p) => p.id === pm.you)!.isModerator).toBe(true);
    await host.send({ type: "setModerator", participantId: host.you!, moderator: false });
    expect(host.errors.at(-1)?.code).toBe("INVALID");
  });

  it("a PM runs the session: tickets, reveal, another round, finalize — others still can't", async () => {
    const { host, pm, bob } = await setup();
    await pm.send({ type: "addTicket", title: "Login" });
    expect(pm.errors.at(-1)?.code).toBe("FORBIDDEN");
    await host.send({ type: "setModerator", participantId: pm.you!, moderator: true });
    await pm.send({ type: "addTicket", title: "Login" });
    await pm.send({ type: "selectTicket", ticketId: pm.view!.tickets[0].id });
    await bob.send({ type: "vote", card: 5 });
    await bob.send({ type: "reveal" });
    expect(bob.errors.at(-1)?.code).toBe("FORBIDDEN");
    await pm.send({ type: "reveal" });
    expect(host.view!.tickets[0].rounds[0].status).toBe("revealed");
    await pm.send({ type: "nextRound" });
    await bob.send({ type: "vote", card: 5 });
    await pm.send({ type: "reveal" });
    await pm.send({ type: "finalize" });
    expect(host.view!.tickets[0].estimate).toBe(5);
    await pm.send({ type: "setRule", rule: "adjacent" }); // the rule stays with the host
    expect(pm.errors.at(-1)?.code).toBe("FORBIDDEN");
  });

  it("a PM reads Jira through the host's helper and imports; answers go only to the asker", async () => {
    const { host, pm, bob } = await setup();
    await pm.send({ type: "jira", reqId: "r0", op: "listBoards", args: [] });
    expect(results(pm).at(-1)).toMatchObject({ reqId: "r0", ok: false });
    await host.send({ type: "setModerator", participantId: pm.you!, moderator: true });
    await pm.send({ type: "jira", reqId: "r1", op: "listBoards", args: [] });
    const boards = results(pm).at(-1)!;
    expect(boards).toMatchObject({ reqId: "r1", ok: true });
    const board = (boards as { data: { id: number }[] }).data[0];
    await pm.send({ type: "jira", reqId: "r2", op: "listIssues", args: [board.id, { scope: "all" }] });
    const issues = results(pm).at(-1) as { ok: boolean; data: { key: string; description: string }[] };
    expect(issues.ok).toBe(true);
    expect(issues.data.length).toBeGreaterThan(0);
    expect(issues.data.every((i) => i.description === "")).toBe(true); // stays at the host
    expect(results(bob)).toHaveLength(0);
    expect(results(host)).toHaveLength(0);
    await pm.send({ type: "importJira", issueKeys: [issues.data[0].key] });
    expect(host.view!.tickets.map((t) => t.key)).toContain(issues.data[0].key);
  });

  it("without the host's helper, a PM gets a clear answer", async () => {
    engine.setJira(null);
    const { host, pm } = await setup();
    await host.send({ type: "setModerator", participantId: pm.you!, moderator: true });
    await pm.send({ type: "jira", reqId: "r1", op: "searchBoards", args: ["x"] });
    expect(results(pm).at(-1)).toMatchObject({ ok: false, error: expect.stringMatching(/helper/) });
  });

  it("rejects writes and unknown Jira operations at the protocol level", async () => {
    const { pm } = await setup();
    await pm.send({ type: "jira", reqId: "r1", op: "writeEstimate", args: ["BMG-1", 5] } as Record<string, unknown>);
    await pm.send({ type: "jira", reqId: "r2", op: "getIssues", args: [] } as Record<string, unknown>);
    expect(pm.errors.map((e) => e.code)).toEqual(["BAD_MESSAGE", "BAD_MESSAGE"]);
  });
});

describe("HostEngine: connections", () => {
  it("requires join first, rejects other rooms and malformed or oversized input", async () => {
    const p = new TestPeer(engine);
    await p.send({ type: "vote", card: 5 });
    await p.link.receive("{nope");
    await p.link.receive(JSON.stringify({ type: "addTicket", title: "x".repeat(70_000) }));
    await p.send({ type: "join", roomId: "OTHER234", name: "A" });
    expect(p.errors.map((e) => e.code)).toEqual(["NOT_JOINED", "BAD_MESSAGE", "BAD_MESSAGE", "NOT_FOUND"]);
    await p.send({ type: "join", roomId: "room2345", name: "A" });
    expect(p.view?.name).toBe("Sprint 42");
  });

  it("the first joiner (the host's own tab) becomes host; everyone sees joins", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    expect(bob.view!.hostId).toBe(host.you);
    expect(host.view!.participants.map((p) => p.name)).toEqual(["Host", "Bob"]);
    await bob.send({ type: "join", roomId: "ROOM2345", name: "Bob" });
    expect(bob.errors[0].code).toBe("INVALID");
  });

  it("never sends hidden votes to other participants before reveal", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    await host.send({ type: "addTicket", title: "Login" });
    await host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await bob.send({ type: "vote", card: 13 });
    // Every state the host received so far exposes who voted, never what.
    const rounds = host.messages.flatMap((m) => (m.type === "state" ? m.room.tickets.flatMap((t) => t.rounds) : []));
    expect(rounds.length).toBeGreaterThan(0);
    for (const r of rounds) expect(r).toMatchObject({ votes: null, stats: null, myVote: null });
    expect(host.view!.tickets[0].rounds[0].voted).toEqual([bob.you]);
    expect(bob.view!.tickets[0].rounds[0].myVote).toBe(13);
    await host.send({ type: "reveal" });
    expect(host.view!.tickets[0].rounds[0].votes).toEqual({ [bob.you!]: 13 });
  });

  it("reconnecting with the token restores identity; a closed link marks the participant offline", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    await host.send({ type: "addTicket", title: "T" });
    await host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await bob.send({ type: "vote", card: 8 });
    bob.link.close();
    expect(host.view!.participants.find((p) => p.name === "Bob")!.connected).toBe(false);
    const again = await join("Bob", { token: bob.token });
    expect(again.you).toBe(bob.you);
    expect(again.view!.tickets[0].rounds[0].myVote).toBe(8);
    expect(host.view!.participants.find((p) => p.name === "Bob")!.connected).toBe(true);
  });

  it("a second tab of the same participant keeps them online when one closes", async () => {
    await join("Host");
    const a = await join("Bob");
    const b = await join("Bob", { token: a.token });
    a.link.close();
    expect(b.view!.participants.find((p) => p.id === b.you)!.connected).toBe(true);
  });

  it("errors for forbidden actions keep the link usable", async () => {
    await join("Host");
    const bob = await join("Bob");
    await bob.send({ type: "addTicket", title: "x" });
    expect(bob.errors[0].code).toBe("FORBIDDEN");
    await bob.send({ type: "ping" });
    expect(bob.messages.at(-1)).toEqual({ type: "pong" });
  });

  it("delivers a ping only to the people who still have to vote", async () => {
    const host = await join("Host");
    const bob = await join("Bob");
    const cara = await join("Cara");
    await host.send({ type: "addTicket", title: "T" });
    await host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await bob.send({ type: "vote", card: 5 });
    await bob.send({ type: "nudge" });
    expect(host.messages.filter((m) => m.type === "nudged")).toEqual([{ type: "nudged", from: "Bob" }]);
    expect(cara.messages.filter((m) => m.type === "nudged")).toEqual([{ type: "nudged", from: "Bob" }]);
    expect(bob.messages.filter((m) => m.type === "nudged")).toEqual([]);
    await bob.send({ type: "nudge" });
    expect(bob.errors.at(-1)!.code).toBe("RATE_LIMITED");
  });

  it("reports every change so the host can persist the room", async () => {
    const host = await join("Host");
    const before = changes;
    await host.send({ type: "addTicket", title: "x" });
    expect(changes).toBeGreaterThan(before);
  });

  it("sends ticket descriptions only for the current ticket (keeps updates small)", async () => {
    const host = await join("Host");
    await host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-102"] });
    const [cur, other] = host.view!.tickets;
    expect(cur.id).toBe(host.view!.currentTicketId);
    expect(cur.description).toContain("reset");
    expect(other.description).toBeUndefined();
  });
});

describe("HostEngine: Jira (the host's browser talks to Jira, guests never do)", () => {
  let host: TestPeer, bob: TestPeer;
  beforeEach(async () => { host = await join("Host"); bob = await join("Bob"); });

  it("imports issues, starts on the first one and keeps metadata", async () => {
    await host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-103"] });
    expect(host.view!.tickets.map((t) => t.key)).toEqual(["DEMO-101", "DEMO-103"]);
    expect(host.view!.currentTicketId).toBe(host.view!.tickets[0].id);
    expect(host.view!.tickets[1]).toMatchObject({ currentEstimate: 13, issueType: "Story", jiraStatus: "To Do" });
    await host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-102"] });
    expect(host.view!.tickets.map((t) => t.key)).toEqual(["DEMO-101", "DEMO-103", "DEMO-102"]);
  });

  it("guests cannot import, and unknown issues are a JIRA error", async () => {
    await bob.send({ type: "importJira", issueKeys: ["DEMO-101"] });
    expect(bob.errors[0].code).toBe("FORBIDDEN");
    await host.send({ type: "importJira", issueKeys: ["NOPE-1"] });
    expect(host.errors[0].code).toBe("JIRA");
  });

  it("writes the agreed estimate and a round summary back, visible to everyone", async () => {
    await host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-102"] });
    await estimate(host, bob, 5);
    expect(bob.view!.tickets[0].writeback.status).toBe("synced");
    expect((await jira.getIssues(["DEMO-101"]))[0].estimate).toBe(5);
    expect(jira.comments["DEMO-101"][0]).toContain("5 story points");
    await host.send({ type: "nextTicket" });
    expect(bob.view!.currentTicketId).toBe(bob.view!.tickets[1].id);
  });

  it("records a failed write-back and lets the host retry", async () => {
    jira.failWrites = "jira is down";
    await host.send({ type: "importJira", issueKeys: ["DEMO-102"] });
    await estimate(host, bob, 8);
    expect(host.view!.tickets[0].writeback).toMatchObject({ status: "failed", error: "jira is down" });
    await bob.send({ type: "retryWriteback", ticketId: host.view!.tickets[0].id });
    expect(bob.errors[0].code).toBe("FORBIDDEN");
    jira.failWrites = null;
    await host.send({ type: "retryWriteback", ticketId: host.view!.tickets[0].id });
    expect(host.view!.tickets[0].writeback.status).toBe("synced");
  });

  it("does not touch Jira for manual tickets, and reports JIRA when the host has no Jira", async () => {
    await host.send({ type: "addTicket", title: "Manual" });
    await host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await estimate(host, bob, 5);
    expect(host.view!.tickets[0].writeback.status).toBe("none");
    engine.setJira(null);
    await host.send({ type: "importJira", issueKeys: ["DEMO-101"] });
    expect(host.errors.at(-1)!.code).toBe("JIRA");
  });
});
