import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error — plain JavaScript module (deployed to Vercel as-is)
import { createRelayServer } from "../relay/src/server.js";
import { MemoryBus } from "../relay/src/bus.js";

const servers: Server[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })));
});

async function relay(bus = new MemoryBus()): Promise<{ url: string; bus: unknown }> {
  const server: Server = createRelayServer(bus);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/relay`, bus };
}

class Client {
  messages: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | null = null;
  ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    sockets.push(this.ws);
    this.ws.onmessage = (e) => this.messages.push(JSON.parse(String(e.data)));
    this.ws.onclose = (e) => { this.closed = { code: e.code, reason: e.reason }; };
  }
  opened() { return new Promise<void>((r, j) => { this.ws.onopen = () => r(); this.ws.onerror = () => j(new Error("ws error")); }); }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  async until(pred: (c: Client) => boolean, ms = 2000) {
    const end = Date.now() + ms;
    while (!pred(this)) {
      if (Date.now() > end) throw new Error("timeout; got " + JSON.stringify(this.messages) + " closed=" + JSON.stringify(this.closed));
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  last(type: string) { return [...this.messages].reverse().find((m) => m.type === type); }
}

const ROOM = "ABCD2345";
const KEY = "k".repeat(32);
const hostUrl = (u: string, key = KEY, room = ROOM) => `${u}?room=${room}&role=host&key=${key}`;
const guestUrl = (u: string, room = ROOM) => `${u}?room=${room}&role=guest`;

describe("relay", () => {
  it("tells guests whether the host is online, and when that changes", async () => {
    const { url } = await relay();
    const g = new Client(guestUrl(url));
    await g.until((c) => c.last("host")?.online === false);
    const h = new Client(hostUrl(url));
    await g.until((c) => c.last("host")?.online === true);
    h.ws.close();
    await g.until((c) => c.last("host")?.online === false);
  });

  it("routes guest → host (with the guest's peer id) and host → that guest only", async () => {
    const { url } = await relay();
    const h = new Client(hostUrl(url));
    await h.opened();
    const a = new Client(guestUrl(url));
    const b = new Client(guestUrl(url));
    await h.until((c) => c.messages.filter((m) => m.type === "open").length === 2);
    a.send({ data: '{"type":"join"}' });
    await h.until((c) => !!c.last("msg"));
    const msg = h.last("msg") as { peer: string; data: string };
    expect(msg.data).toBe('{"type":"join"}');
    h.send({ to: msg.peer, data: '{"type":"welcome"}' });
    await a.until((c) => !!c.last("msg"));
    expect(a.last("msg")).toEqual({ type: "msg", data: '{"type":"welcome"}' });
    await new Promise((r) => setTimeout(r, 100));
    expect(b.last("msg")).toBeUndefined();
  });

  it("works when host and guest land on different relay instances (shared bus)", async () => {
    const bus = new MemoryBus();
    const one = await relay(bus);
    const two = await relay(bus);
    const h = new Client(hostUrl(one.url));
    await h.opened();
    const g = new Client(guestUrl(two.url));
    await g.until((c) => c.last("host")?.online === true);
    g.send({ data: "hi" });
    await h.until((c) => c.last("msg")?.data === "hi");
    h.send({ to: (h.last("msg") as { peer: string }).peer, data: "back" });
    await g.until((c) => c.last("msg")?.data === "back");
  });

  it("tells the host when a guest leaves", async () => {
    const { url } = await relay();
    const h = new Client(hostUrl(url));
    await h.opened();
    const g = new Client(guestUrl(url));
    await h.until((c) => !!c.last("open"));
    const peer = (h.last("open") as { peer: string }).peer;
    g.ws.close();
    await h.until((c) => c.last("close")?.peer === peer);
  });

  it("only the holder of the host key can host a room", async () => {
    const { url } = await relay();
    const h = new Client(hostUrl(url));
    await h.opened();
    const thief = new Client(hostUrl(url, "x".repeat(32)));
    await thief.until((c) => c.closed !== null);
    expect(thief.closed!.code).toBe(4003);
    expect(h.closed).toBeNull();
  });

  it("a newer tab with the same key takes over; the old one is told and closed", async () => {
    const { url } = await relay();
    const first = new Client(hostUrl(url));
    await first.opened();
    const second = new Client(hostUrl(url));
    await second.opened();
    await first.until((c) => c.closed !== null);
    expect(first.closed!.code).toBe(4009);
    const g = new Client(guestUrl(url));
    await second.until((c) => !!c.last("open"));
  });

  it("rejects malformed connections and messages", async () => {
    const { url } = await relay();
    for (const bad of [`${url}?room=nope&role=guest`, `${url}?room=${ROOM}&role=admin`, `${url}?room=${ROOM}&role=host&key=short`]) {
      const c = new Client(bad);
      await c.until((x) => x.closed !== null);
      expect(c.closed!.code).toBe(4400);
    }
    const h = new Client(hostUrl(url));
    await h.opened();
    h.ws.send("{not json");
    h.send({ to: 42, data: "x" });
    await h.until((c) => c.messages.filter((m) => m.type === "error").length === 2);
    expect(h.closed).toBeNull();
  });

  it("answers pings (keeps idle connections alive) and reports health over HTTP", async () => {
    const { url } = await relay();
    const g = new Client(guestUrl(url));
    await g.opened();
    g.send({ type: "ping" });
    await g.until((c) => !!c.last("pong"));
    const res = await fetch(url.replace("ws:", "http:"));
    expect(await res.json()).toMatchObject({ ok: true, bus: "memory" });
  });
});
