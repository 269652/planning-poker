import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error — plain JavaScript module
import { createRelayServer } from "../relay/src/server.js";
// @ts-expect-error — plain JavaScript module
import { MemoryBus } from "../relay/src/bus.js";
import { Room, type RoomView } from "@/core/room";
import type { ServerMessage } from "@/core/protocol";
import { HostEngine } from "@/host/engine";
import { hostRoom, joinRoom, type GuestState, type HostState } from "@/net/relay";

const servers: Server[] = [];
const stops: (() => void)[] = [];
afterEach(async () => {
  stops.splice(0).forEach((s) => s());
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })));
});

async function relayUrl(): Promise<string> {
  const server: Server = createRelayServer(new MemoryBus());
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/relay`;
}

const until = async (pred: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); }
};

/** A guest using the real client module, like the browser does. */
function guest(url: string, roomId: string, name: string, token?: string) {
  const g = { view: null as RoomView | null, token, you: "", states: [] as GuestState[], send: (_: unknown) => false as boolean };
  const conn = joinRoom(roomId, {
    onOpen: () => conn.send({ type: "join", roomId, name, role: "voter", token: g.token }),
    onMessage: (m: ServerMessage) => {
      if (m.type === "welcome") { g.token = m.token; g.you = m.you; }
      if (m.type === "state") g.view = m.room;
    },
    onState: (s) => g.states.push(s),
  }, url);
  g.send = (m) => conn.send(m as never);
  stops.push(conn.stop);
  return g;
}

describe("room over the relay (browser client modules + host engine)", () => {
  it("guests join the host's room, vote secretly and see the reveal", async () => {
    const url = await relayUrl();
    const room = Room.create({ id: "ABCD2345", name: "Relay room" });
    const engine = new HostEngine({ room, jira: null });
    // The host's own tab joins through a local link, as in the app.
    let hostView: RoomView | null = null;
    const local = engine.connect((m) => { if (m.type === "state") hostView = m.room; });
    await local.receive(JSON.stringify({ type: "join", roomId: "ABCD2345", name: "Host" }));
    const states: HostState[] = [];
    stops.push(hostRoom(engine, { url, hostKey: "h".repeat(32) }, (s) => states.push(s)));
    await until(() => states.includes("online"));

    const bob = guest(url, "ABCD2345", "Bob");
    await until(() => bob.view?.participants.length === 2);
    expect(bob.states).toContain("open");

    await local.receive(JSON.stringify({ type: "addTicket", title: "T" }));
    await local.receive(JSON.stringify({ type: "selectTicket", ticketId: hostView!.tickets[0].id }));
    bob.send({ type: "vote", card: 8 });
    await until(() => hostView!.participants.find((p) => p.name === "Bob")!.hasVoted);
    expect(hostView!.tickets[0].rounds[0].votes).toBeNull();
    await local.receive(JSON.stringify({ type: "reveal" }));
    await until(() => bob.view?.tickets[0].rounds[0].status === "revealed");
    expect(Object.values(bob.view!.tickets[0].rounds[0].votes!)).toEqual([8]);
  });

  it("when the host reconnects (e.g. Vercel's duration limit), guests re-join with their token", async () => {
    const url = await relayUrl();
    const engine = new HostEngine({ room: Room.create({ id: "ABCD2345", name: "R" }), jira: null });
    await engine.connect(() => {}).receive(JSON.stringify({ type: "join", roomId: "ABCD2345", name: "Host" }));
    const states: HostState[] = [];
    const stopHost = hostRoom(engine, { url, hostKey: "h".repeat(32) }, (s) => states.push(s));
    await until(() => states.includes("online"));
    const bob = guest(url, "ABCD2345", "Bob");
    await until(() => !!bob.you);
    const firstId = bob.you;

    stopHost();
    await until(() => bob.states.at(-1) === "host-offline");
    await until(() => bob.view!.participants.find((p) => p.id === firstId)!.connected === true);
    const again: HostState[] = [];
    stops.push(hostRoom(engine, { url, hostKey: "h".repeat(32) }, (s) => again.push(s)));
    await until(() => bob.states.at(-1) === "open");
    await until(() => bob.view!.participants.filter((p) => p.name === "Bob").length === 1 && bob.you === firstId);
    expect(bob.view!.participants.find((p) => p.id === firstId)!.connected).toBe(true);
  });
});
