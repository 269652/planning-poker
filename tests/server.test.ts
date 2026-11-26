import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createPokerServer, type PokerServer } from "@/server/app";
import { MockJira } from "@/jira/mock";
import type { RoomView } from "@/core/room";
import type { ClientMessage, ServerMessage } from "@/core/protocol";

class Client {
  ws!: WebSocket;
  view?: RoomView;
  token?: string;
  you?: string;
  errors: { code: string; message: string }[] = [];
  raw: string[] = [];
  private waiters: (() => void)[] = [];

  static async open(port: number): Promise<Client> {
    const c = new Client();
    c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    c.ws.on("message", (d) => {
      const text = d.toString();
      c.raw.push(text);
      const m = JSON.parse(text) as ServerMessage;
      if (m.type === "welcome") { c.token = m.token; c.you = m.you; }
      if (m.type === "state") c.view = m.room;
      if (m.type === "error") c.errors.push(m);
      c.waiters.splice(0).forEach((w) => w());
    });
    await new Promise<void>((res, rej) => { c.ws.once("open", () => res()); c.ws.once("error", rej); });
    return c;
  }
  send(m: ClientMessage | Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  async until(pred: () => boolean, ms = 2000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error("timeout waiting for condition; last view: " + JSON.stringify(this.view)?.slice(0, 400) + " errors: " + JSON.stringify(this.errors));
      await new Promise<void>((res) => { this.waiters.push(res); setTimeout(res, 50); });
    }
  }
  close() { this.ws.close(); }
}

let servers: PokerServer[] = [];
let clients: Client[] = [];
let dirs: string[] = [];

afterEach(async () => {
  clients.forEach((c) => c.ws.terminate()); clients = [];
  await Promise.all(servers.map((s) => s.close())); servers = [];
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = [];
});

async function boot(opts: { jira?: MockJira | null; dataDir?: string } = {}) {
  const jira = opts.jira === undefined ? new MockJira() : opts.jira;
  const s = createPokerServer({ jira, dataDir: opts.dataDir, persistDelayMs: 5 });
  servers.push(s);
  await new Promise<void>((res) => s.server.listen(0, "127.0.0.1", res));
  const port = (s.server.address() as AddressInfo).port;
  const http = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, init);
  const createRoom = async (name = "Sprint 1") => {
    const r = await http("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    return (await r.json()) as { id: string };
  };
  const join = async (roomId: string, name: string, extra: Record<string, unknown> = {}) => {
    const c = await Client.open(port);
    clients.push(c);
    c.send({ type: "join", roomId, name, ...extra });
    await c.until(() => !!c.view || c.errors.length > 0);
    return c;
  };
  return { s, port, http, jira, createRoom, join };
}

describe("HTTP API", () => {
  it("creates and looks up rooms", async () => {
    const { http, createRoom } = await boot();
    const { id } = await createRoom("Alpha");
    expect(id).toMatch(/^[A-Z2-9]{8}$/);
    const r = await http(`/api/rooms/${id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id, name: "Alpha" });
    expect((await http("/api/rooms/NOPE0000")).status).toBe(404);
  });

  it("rejects room creation without a name", async () => {
    const { http } = await boot();
    const r = await http("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: " " }) });
    expect(r.status).toBe(400);
  });

  it("reports Jira status", async () => {
    expect(await (await (await boot()).http("/api/jira/status")).json()).toEqual({ configured: true, kind: "mock" });
    expect(await (await (await boot({ jira: null })).http("/api/jira/status")).json()).toEqual({ configured: false, kind: null });
  });

  it("jira browsing requires the host's participant token", async () => {
    const { http, createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    const bob = await join(id, "Bob");
    expect((await http(`/api/rooms/${id}/jira/boards`)).status).toBe(401);
    expect((await http(`/api/rooms/${id}/jira/boards`, { headers: { "x-participant-token": bob.token! } })).status).toBe(403);
    const ok = await http(`/api/rooms/${id}/jira/boards`, { headers: { "x-participant-token": host.token! } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).boards[0]).toMatchObject({ id: 1 });
    const sprints = await (await http(`/api/rooms/${id}/jira/boards/1/sprints`, { headers: { "x-participant-token": host.token! } })).json();
    expect(sprints.sprints.length).toBeGreaterThan(0);
    const issues = await (await http(`/api/rooms/${id}/jira/boards/1/issues?sprintId=10`, { headers: { "x-participant-token": host.token! } })).json();
    expect(issues.issues).toHaveLength(3);
  });

  it("jira browsing returns 503 when Jira is not configured", async () => {
    const { http, createRoom, join } = await boot({ jira: null });
    const { id } = await createRoom();
    const host = await join(id, "Host");
    expect((await http(`/api/rooms/${id}/jira/boards`, { headers: { "x-participant-token": host.token! } })).status).toBe(503);
  });

  it("exports the full round history without secrets", async () => {
    const { http, createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    host.send({ type: "addTicket", title: "T" });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].rounds.length === 1);
    host.send({ type: "vote", card: 5 });
    await host.until(() => host.view!.tickets[0].rounds[0].myVote === 5);
    host.send({ type: "reveal" });
    await host.until(() => host.view!.tickets[0].rounds[0].status === "revealed");
    const body = await (await http(`/api/rooms/${id}/export`, { headers: { "x-participant-token": host.token! } })).text();
    expect(body).toContain('"rounds"');
    expect(body).not.toContain(host.token!);
    expect((await http(`/api/rooms/${id}/export`)).status).toBe(401);
  });
});

describe("WebSocket protocol", () => {
  it("requires join first and rejects unknown rooms", async () => {
    const { port, join, createRoom } = await boot();
    const c = await Client.open(port); clients.push(c);
    c.send({ type: "vote", card: 5 });
    await c.until(() => c.errors.length > 0);
    expect(c.errors[0].code).toBe("NOT_JOINED");
    const bad = await join("NOPE0000", "X");
    expect(bad.errors[0].code).toBe("NOT_FOUND");
    await createRoom();
  });

  it("survives malformed messages", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    const c = await join(id, "A");
    c.ws.send("{broken");
    c.send({ type: "nope" });
    await c.until(() => c.errors.length >= 2);
    expect(c.errors.every((e) => e.code === "BAD_MESSAGE")).toBe(true);
    c.send({ type: "ping" });
    await c.until(() => c.raw.some((r) => r.includes('"pong"')));
  });

  it("broadcasts joins in realtime", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    expect(host.view!.participants).toHaveLength(1);
    await join(id, "Bob");
    await host.until(() => host.view!.participants.length === 2);
    expect(host.view!.hostId).toBe(host.you);
  });

  it("never sends hidden votes over the wire before reveal", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    const bob = await join(id, "Bob");
    host.send({ type: "addTicket", title: "T" });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await bob.until(() => bob.view!.currentTicketId !== null);
    const before = host.raw.length;
    bob.send({ type: "vote", card: 89 });
    await host.until(() => host.view!.participants.find((p) => p.id === bob.you)!.hasVoted);
    // Structural check on every frame the host received after Bob voted: the card must not appear anywhere.
    const frames = host.raw.slice(before).map((r) => JSON.parse(r)).filter((m) => m.type === "state");
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const round = f.room.tickets[0].rounds[0];
      expect(round.votes).toBeNull();
      expect(round.myVote).toBeNull();
      expect(round.stats).toBeNull();
      expect(round.voted).toContain(bob.you); // who voted is public, what they voted is not
    }
    host.send({ type: "reveal" });
    await host.until(() => host.view!.tickets[0].rounds[0].votes !== null);
    expect(host.view!.tickets[0].rounds[0].votes![bob.you!]).toBe(89);
    await bob.until(() => bob.view!.tickets[0].rounds[0].stats !== null);
  });

  it("returns errors for forbidden actions and keeps the socket open", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    await join(id, "Host");
    const bob = await join(id, "Bob");
    bob.send({ type: "addTicket", title: "nope" });
    await bob.until(() => bob.errors.length > 0);
    expect(bob.errors[0].code).toBe("FORBIDDEN");
    expect(bob.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("reconnecting with the token restores identity and the hidden vote", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    const bob = await join(id, "Bob");
    host.send({ type: "addTicket", title: "T" });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await bob.until(() => bob.view!.currentTicketId !== null);
    bob.send({ type: "vote", card: 8 });
    await bob.until(() => bob.view!.tickets[0].rounds[0].myVote === 8);
    const { token, you } = bob;
    bob.close();
    await host.until(() => host.view!.participants.find((p) => p.id === you)!.connected === false);
    const again = await join(id, "Bob", { token });
    expect(again.you).toBe(you);
    expect(again.view!.tickets[0].rounds[0].myVote).toBe(8);
    await host.until(() => host.view!.participants.find((p) => p.id === you)!.connected === true);
    expect(host.view!.participants).toHaveLength(2);
  });

  it("full multi-round flow records history and convergence", async () => {
    const { createRoom, join } = await boot();
    const { id } = await createRoom();
    const host = await join(id, "Host");
    const bob = await join(id, "Bob");
    host.send({ type: "addTicket", title: "T" });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].rounds.length === 1);

    host.send({ type: "vote", card: 3 }); bob.send({ type: "vote", card: 21 });
    await host.until(() => host.view!.participants.every((p) => p.hasVoted));
    host.send({ type: "reveal" });
    await host.until(() => host.view!.tickets[0].rounds[0].status === "revealed");
    host.send({ type: "finalize" });
    await host.until(() => host.errors.length > 0);
    expect(host.errors[0].code).toBe("NO_AGREEMENT");

    host.send({ type: "nextRound" });
    await host.until(() => host.view!.tickets[0].rounds.length === 2);
    host.send({ type: "vote", card: 8 }); bob.send({ type: "vote", card: 8 });
    await host.until(() => host.view!.participants.every((p) => p.hasVoted));
    host.send({ type: "reveal" });
    host.send({ type: "finalize" });
    await host.until(() => host.view!.tickets[0].status === "estimated");
    const t = host.view!.tickets[0];
    expect(t).toMatchObject({ estimate: 8, resolution: "agreement" });
    expect(t.convergence).toMatchObject({ trend: "agreed", roundsToAgreement: 2 });
    expect(t.writeback.status).toBe("none");
  });
});

describe("Jira integration", () => {
  async function setup() {
    const ctx = await boot();
    const { id } = await ctx.createRoom("Sprint 42");
    const host = await ctx.join(id, "Host");
    const bob = await ctx.join(id, "Bob");
    return { ...ctx, id, host, bob };
  }

  async function estimateCurrent(host: Client, bob: Client, card: 5 | 8) {
    host.send({ type: "vote", card }); bob.send({ type: "vote", card });
    await host.until(() => host.view!.participants.every((p) => p.hasVoted));
    host.send({ type: "reveal" });
    host.send({ type: "finalize" });
  }

  it("imports issues by key with their current estimate and url", async () => {
    const { host } = await setup();
    host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-103"] });
    await host.until(() => host.view!.tickets.length === 2);
    expect(host.view!.tickets[0]).toMatchObject({ key: "DEMO-101", source: "jira", currentEstimate: null });
    expect(host.view!.tickets[1]).toMatchObject({ key: "DEMO-103", currentEstimate: 13 });
    expect(host.view!.tickets[0].url).toContain("DEMO-101");
  });

  it("importing the same key twice does not duplicate it", async () => {
    const { host } = await setup();
    host.send({ type: "importJira", issueKeys: ["DEMO-101"] });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "importJira", issueKeys: ["DEMO-101", "DEMO-102"] });
    await host.until(() => host.view!.tickets.length === 2);
    expect(host.view!.tickets.map((t) => t.key)).toEqual(["DEMO-101", "DEMO-102"]);
  });

  it("reports unknown issues as a JIRA error", async () => {
    const { host } = await setup();
    host.send({ type: "importJira", issueKeys: ["NOPE-1"] });
    await host.until(() => host.errors.length > 0);
    expect(host.errors[0].code).toBe("JIRA");
    expect(host.view!.tickets).toHaveLength(0);
  });

  it("writes the agreed estimate and a round summary back to Jira", async () => {
    const { host, bob, jira } = await setup();
    host.send({ type: "importJira", issueKeys: ["DEMO-101"] });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].rounds.length === 1);
    await estimateCurrent(host, bob, 5);
    await host.until(() => host.view!.tickets[0].writeback.status === "synced");
    const [issue] = await jira!.getIssues(["DEMO-101"]);
    expect(issue.estimate).toBe(5);
    expect(jira!.comments["DEMO-101"][0]).toContain("5 story points");
    expect(jira!.comments["DEMO-101"][0]).toContain("Sprint 42");
  });

  it("records a failed write-back and lets the host retry", async () => {
    const { host, bob, jira } = await setup();
    jira!.failWrites = "jira is down";
    host.send({ type: "importJira", issueKeys: ["DEMO-102"] });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].rounds.length === 1);
    await estimateCurrent(host, bob, 8);
    await host.until(() => host.view!.tickets[0].writeback.status === "failed");
    expect(host.view!.tickets[0].writeback.error).toContain("jira is down");
    expect(host.view!.tickets[0].status).toBe("estimated"); // the agreement itself is kept

    jira!.failWrites = null;
    host.send({ type: "retryWriteback", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].writeback.status === "synced");
    expect((await jira!.getIssues(["DEMO-102"]))[0].estimate).toBe(8);
  });

  it("does not touch Jira for manual tickets", async () => {
    const { host, bob, jira } = await setup();
    host.send({ type: "addTicket", title: "Manual" });
    await host.until(() => host.view!.tickets.length === 1);
    host.send({ type: "selectTicket", ticketId: host.view!.tickets[0].id });
    await host.until(() => host.view!.tickets[0].rounds.length === 1);
    await estimateCurrent(host, bob, 5);
    await host.until(() => host.view!.tickets[0].status === "estimated");
    expect(host.view!.tickets[0].writeback.status).toBe("none");
    expect(Object.keys(jira!.comments)).toHaveLength(0);
  });

  it("refuses retryWriteback for non-host", async () => {
    const { host, bob } = await setup();
    host.send({ type: "importJira", issueKeys: ["DEMO-101"] });
    await host.until(() => host.view!.tickets.length === 1);
    bob.send({ type: "retryWriteback", ticketId: host.view!.tickets[0].id });
    await bob.until(() => bob.errors.length > 0);
    expect(bob.errors[0].code).toBe("FORBIDDEN");
  });

  it("reports JIRA error when Jira is not configured", async () => {
    const ctx = await boot({ jira: null });
    const { id } = await ctx.createRoom();
    const host = await ctx.join(id, "Host");
    host.send({ type: "importJira", issueKeys: ["A-1"] });
    await host.until(() => host.errors.length > 0);
    expect(host.errors[0].code).toBe("JIRA");
  });
});

describe("persistence", () => {
  it("rooms survive a server restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "poker-"));
    dirs.push(dir);
    const a = await boot({ dataDir: dir });
    const { id } = await a.createRoom("Persist me");
    const host = await a.join(id, "Host");
    host.send({ type: "addTicket", title: "Kept" });
    await host.until(() => host.view!.tickets.length === 1);
    const { token } = host;
    await a.s.close();
    servers = servers.filter((s) => s !== a.s);

    const b = await boot({ dataDir: dir });
    expect((await (await b.http(`/api/rooms/${id}`)).json()).name).toBe("Persist me");
    const again = await b.join(id, "Host", { token });
    expect(again.view!.tickets[0].title).toBe("Kept");
    expect(again.you).toBe(host.you);
  });
});
