import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MockJiraGateway } from '@/jira/gateway';
import { RoomManager } from '@/server/roomManager';
import { attachRealtime, isOriginAllowed } from '@/server/ws';

let server: http.Server;
let port: number;
let handle: { close(): void };
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = http.createServer((_, res) => res.end('ok'));
  handle = attachRealtime(server, new RoomManager({ gateway: new MockJiraGateway() }), { heartbeatMs: 0 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  handle.close();
  await new Promise((r) => server.close(r));
});

class Client {
  msgs: any[] = [];
  private ws: WebSocket;
  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    sockets.push(this.ws);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d))));
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
      this.ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  async until(pred: (m: any) => boolean, ms = 2000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const hit = this.msgs.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timeout waiting for message; got ' + JSON.stringify(this.msgs.slice(-3)));
  }
  async nextState(pred: (v: any) => boolean) {
    const seen = this.msgs.length;
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const hit = this.msgs.slice(0).reverse().find((m) => m.type === 'state' && pred(m.view));
      if (hit) return hit.view;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('no matching state after ' + seen);
  }
}

const join = (c: Client, name: string, k: string) =>
  c.send({ type: 'join', roomId: 'room-ws', roomName: 'WS room', clientKey: k.padEnd(20, '-'), name });

describe('websocket realtime', () => {
  it('syncs two clients through a full planning round', async () => {
    const a = new Client(); const b = new Client();
    await Promise.all([a.open(), b.open()]);
    join(a, 'Alice', 'alice'); join(b, 'Bob', 'bob');
    await b.nextState((v) => v.participants.length === 2);

    a.send({ type: 'action', action: { type: 'addTicket', ticket: { title: 'Realtime ticket' } } });
    await b.nextState((v) => v.tickets.length === 1);
    a.send({ type: 'action', action: { type: 'selectTicket', ticketId: 't1' } });
    a.send({ type: 'action', action: { type: 'vote', card: 13 } });

    const hidden = await b.nextState((v) => v.participants.some((p: any) => p.hasVoted));
    expect(hidden.participants.every((p: any) => p.vote === null)).toBe(true);
    expect(JSON.stringify(b.msgs.filter((m) => m.type === 'state').pop())).not.toContain('"vote":13');

    b.send({ type: 'action', action: { type: 'vote', card: 13 } });
    a.send({ type: 'action', action: { type: 'reveal' } });
    const revealed = await b.nextState((v) => v.tickets[0]?.status === 'revealed');
    expect(revealed.tickets[0].rounds[0].stats.consensus).toBe(true);
    expect(revealed.tickets[0].rounds[0].votes).toBeTruthy();

    a.send({ type: 'action', action: { type: 'accept' } });
    const agreed = await b.nextState((v) => v.tickets[0]?.status === 'agreed');
    expect(agreed.tickets[0]).toMatchObject({ estimate: 13, resolution: 'consensus' });
  });

  it('answers malformed frames with an error and keeps the socket usable', async () => {
    const a = new Client();
    await a.open();
    a.send('garbage'); // JSON string, not a valid message
    await a.until((m) => m.type === 'error' && m.code === 'bad_request');
    a.send({ type: 'ping' });
    await a.until((m) => m.type === 'pong');
  });

  it('closes connections that send oversized frames', async () => {
    const a = new Client();
    await a.open();
    const closed = new Promise((r) => (a as any).ws.once('close', r));
    a.send({ type: 'join', roomId: 'room-ws', clientKey: 'k'.repeat(20), name: 'x'.repeat(200_000) });
    await closed;
  });

  it('rejects cross-origin upgrades', async () => {
    const evil = new Client({ Origin: 'http://evil.example' });
    await expect(evil.open()).rejects.toThrow(/403/);
    const same = new Client({ Origin: `http://127.0.0.1:${port}` });
    await same.open();
  });
});

describe('isOriginAllowed', () => {
  it('allows non-browser clients, same host, and allow-listed origins', () => {
    expect(isOriginAllowed(undefined, 'a:1', [])).toBe(true);
    expect(isOriginAllowed('http://a:1', 'a:1', [])).toBe(true);
    expect(isOriginAllowed('https://poker.corp', 'internal:3000', ['https://poker.corp'])).toBe(true);
    expect(isOriginAllowed('http://evil.example', 'a:1', [])).toBe(false);
    expect(isOriginAllowed('not a url', 'a:1', [])).toBe(false);
  });
});
