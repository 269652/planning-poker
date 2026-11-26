import { beforeEach, describe, expect, it } from 'vitest';
import { RoomManager, type Connection } from '@/server/roomManager';
import { MockJiraGateway } from '@/jira/gateway';

type Msg = Record<string, any>;
type Any = any;
interface Client { conn: Connection; msgs: Msg[]; key: string }

let mgr: RoomManager;
let gw: MockJiraGateway | null;
let clock: number;

function make(key: string): Client {
  const msgs: Msg[] = [];
  return { msgs, key, conn: { send: (d: string) => msgs.push(JSON.parse(d)) } };
}
const send = (c: Client, m: Msg) => mgr.handleMessage(c.conn, JSON.stringify(m));
const join = (c: Client, name: string, extra: Msg = {}) =>
  send(c, { type: 'join', roomId: 'room-1', roomName: 'Sprint 42', clientKey: c.key, name, ...extra });
const act = (c: Client, action: Msg) => send(c, { type: 'action', action });
const jira = (c: Client, reqId: string, rest: Msg) => send(c, { type: 'jira', reqId, ...rest });
const lastOf = (c: Client, type: string) => [...c.msgs].reverse().find((m) => m.type === type);
const view = (c: Client): Any => lastOf(c, 'state')!.view;
const key = (n: string) => `${n}-`.padEnd(24, 'x');

async function setup(withGateway = true) {
  gw = withGateway ? new MockJiraGateway() : null;
  clock = 1;
  mgr = new RoomManager({ gateway: gw, now: () => clock });
  const alice = make(key('alice'));
  const bob = make(key('bob'));
  await join(alice, 'Alice');
  await join(bob, 'Bob');
  return { alice, bob };
}

describe('joining and broadcasting', () => {
  it('creates the room on first join, makes the joiner host and hides the secret key', async () => {
    const { alice } = await setup();
    const v = view(alice);
    expect(v.name).toBe('Sprint 42');
    expect(v.hostId).toBe(v.you);
    expect(v.you).not.toContain('alice');
    expect(JSON.stringify(alice.msgs)).not.toContain(alice.key);
  });

  it('broadcasts to everyone, each with their own projection', async () => {
    const { alice, bob } = await setup();
    expect(view(alice).participants).toHaveLength(2);
    expect(view(bob).participants).toHaveLength(2);
    expect(view(alice).you).not.toBe(view(bob).you);
  });

  it('rejects malformed room ids and short keys', async () => {
    mgr = new RoomManager({ gateway: null, now: () => 1 });
    const c = make('short');
    await send(c, { type: 'join', roomId: 'x', clientKey: c.key, name: 'A' });
    expect(lastOf(c, 'error')!.code).toBe('bad_request');
    await send(c, { type: 'join', roomId: 'room-1', clientKey: 'short', name: 'A' });
    expect(lastOf(c, 'error')!.code).toBe('bad_request');
  });

  it('requires join before anything else, and rejects junk', async () => {
    mgr = new RoomManager({ gateway: null, now: () => 1 });
    const c = make(key('c'));
    await act(c, { type: 'reveal' });
    expect(lastOf(c, 'error')!.code).toBe('not_joined');
    await mgr.handleMessage(c.conn, 'not json');
    expect(lastOf(c, 'error')!.code).toBe('bad_request');
    await send(c, { type: 'nope' });
    expect(lastOf(c, 'error')!.code).toBe('bad_request');
  });

  it('answers ping with pong', async () => {
    const { alice } = await setup();
    await send(alice, { type: 'ping' });
    expect(lastOf(alice, 'pong')).toBeTruthy();
  });
});

describe('secrecy and identity', () => {
  async function estimating() {
    const { alice, bob } = await setup();
    await act(alice, { type: 'addTicket', ticket: { title: 'T' } });
    await act(alice, { type: 'selectTicket', ticketId: 't1' });
    return { alice, bob };
  }

  it('never sends a hidden vote to other clients', async () => {
    const { alice, bob } = await estimating();
    await act(alice, { type: 'vote', card: 89 });
    expect(view(bob).participants.find((p: Any) => p.id === view(alice).you)).toMatchObject({ hasVoted: true, vote: null });
    expect(JSON.stringify(bob.msgs.slice(-1))).not.toContain('89');
    expect(view(alice).participants.find((p: Any) => p.id === view(alice).you)!.vote).toBe(89);
    await act(bob, { type: 'vote', card: 89 });
    await act(alice, { type: 'reveal' });
    expect(view(bob).tickets[0].rounds[0].votes).toBeTruthy();
    expect(view(bob).tickets[0].rounds[0].stats.consensus).toBe(true);
  });

  it('cannot be impersonated with a public participant id', async () => {
    const { alice } = await estimating();
    const hostPublicId = view(alice).you;
    const mallory = make(hostPublicId.padEnd(24, '0'));
    await join(mallory, 'Mallory');
    expect(view(mallory).you).not.toBe(hostPublicId);
    await act(mallory, { type: 'reveal' });
    expect(lastOf(mallory, 'error')!.code).toBe('forbidden');
  });

  it('sends reducer errors only to the sender', async () => {
    const { alice, bob } = await estimating();
    const before = alice.msgs.length;
    await act(bob, { type: 'reveal' });
    expect(lastOf(bob, 'error')).toMatchObject({ code: 'forbidden' });
    expect(alice.msgs.length).toBe(before);
  });

  it('reconnecting with the same key restores identity and role', async () => {
    const { alice } = await estimating();
    const id = view(alice).you;
    mgr.disconnect(alice.conn);
    const again = make(alice.key);
    await join(again, 'Alice');
    expect(view(again).you).toBe(id);
    expect(view(again).hostId).toBe(id);
  });
});

describe('presence', () => {
  it('marks disconnects, keeps participants with another open tab connected', async () => {
    const { alice, bob } = await setup();
    const bobId = view(bob).you;
    const tab2 = make(bob.key);
    await join(tab2, 'Bob');
    mgr.disconnect(bob.conn);
    expect(view(alice).participants.find((p: Any) => p.id === bobId)!.connected).toBe(true);
    mgr.disconnect(tab2.conn);
    expect(view(alice).participants.find((p: Any) => p.id === bobId)!.connected).toBe(false);
  });

  it('sweeps empty idle rooms only', async () => {
    const { alice, bob } = await setup();
    clock = 10_000;
    expect(mgr.sweep(1000)).toBe(0);
    mgr.disconnect(alice.conn);
    mgr.disconnect(bob.conn);
    clock = 20_000;
    expect(mgr.sweep(1000)).toBe(1);
    expect(mgr.roomCount).toBe(0);
  });
});

describe('jira', () => {
  async function importedAndEstimating() {
    const { alice, bob } = await setup();
    await jira(alice, 'r1', { op: 'boards' });
    const boards = lastOf(alice, 'jiraResult')!.data;
    await jira(alice, 'r2', { op: 'import', boardId: boards[0].id, sprintId: 11 });
    return { alice, bob };
  }
  async function agree(alice: Client, bob: Client, ticketId = 't1', card = 5) {
    await act(alice, { type: 'selectTicket', ticketId });
    await act(alice, { type: 'vote', card });
    await act(bob, { type: 'vote', card });
    await act(alice, { type: 'reveal' });
    await act(alice, { type: 'accept' });
  }

  it('reports status to anyone', async () => {
    const { bob } = await setup();
    await jira(bob, 's', { op: 'status' });
    expect(lastOf(bob, 'jiraResult')).toMatchObject({ reqId: 's', ok: true, data: { enabled: true, mode: 'mock' } });
  });

  it('restricts browsing and importing to the host', async () => {
    const { bob } = await setup();
    await jira(bob, 'x', { op: 'boards' });
    expect(lastOf(bob, 'jiraResult')).toMatchObject({ reqId: 'x', ok: false });
  });

  it('imports board issues into the room backlog', async () => {
    const { alice, bob } = await importedAndEstimating();
    expect(lastOf(alice, 'jiraResult')).toMatchObject({ reqId: 'r2', ok: true, data: { count: 4 } });
    expect(view(bob).tickets.map((t: Any) => t.key)).toEqual(['DEMO-101', 'DEMO-102', 'DEMO-103', 'DEMO-104']);
  });

  it('writes the agreed estimate and round summary back automatically', async () => {
    const { alice, bob } = await importedAndEstimating();
    await agree(alice, bob);
    expect(gw!.written).toHaveLength(1);
    expect(gw!.written[0]).toMatchObject({ key: 'DEMO-101', points: 5 });
    expect(gw!.written[0].lines[0]).toContain('5 story points');
    expect(view(bob).tickets[0].jira.writeStatus).toBe('written');
  });

  it('does not write back in manual mode until the host asks', async () => {
    const { alice, bob } = await importedAndEstimating();
    await act(alice, { type: 'setSettings', writeBack: 'manual' });
    await agree(alice, bob);
    expect(gw!.written).toHaveLength(0);
    expect(view(bob).tickets[0].jira.writeStatus).toBe('none');
    await jira(bob, 'w0', { op: 'writeBack', ticketId: 't1' });
    expect(lastOf(bob, 'jiraResult')!.ok).toBe(false);
    await jira(alice, 'w1', { op: 'writeBack', ticketId: 't1' });
    expect(lastOf(alice, 'jiraResult')!.ok).toBe(true);
    expect(gw!.written).toHaveLength(1);
  });

  it('records failures and allows a retry', async () => {
    const { alice, bob } = await importedAndEstimating();
    const original = gw!.writeEstimate.bind(gw);
    gw!.writeEstimate = async () => { throw new Error('Jira 403: nope'); };
    await agree(alice, bob);
    expect(view(bob).tickets[0].jira).toMatchObject({ writeStatus: 'failed', error: 'Jira 403: nope' });
    gw!.writeEstimate = original;
    await jira(alice, 'retry', { op: 'writeBack', ticketId: 't1' });
    expect(view(bob).tickets[0].jira.writeStatus).toBe('written');
  });

  it('does not write manual tickets or refuse to run without Jira', async () => {
    const { alice, bob } = await setup(false);
    await act(alice, { type: 'addTicket', ticket: { title: 'Manual' } });
    await act(alice, { type: 'selectTicket', ticketId: 't1' });
    await act(alice, { type: 'vote', card: 3 });
    await act(bob, { type: 'vote', card: 3 });
    await act(alice, { type: 'reveal' });
    await act(alice, { type: 'accept' });
    expect(view(bob).tickets[0]).toMatchObject({ status: 'agreed', estimate: 3 });
    expect(view(bob).tickets[0].jira.writeStatus).toBe('none');
    await jira(alice, 'j', { op: 'status' });
    expect(lastOf(alice, 'jiraResult')!.data.enabled).toBe(false);
    await jira(alice, 'b', { op: 'boards' });
    expect(lastOf(alice, 'jiraResult')).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/i) });
  });

  it('ignores a stale write result when the ticket was reopened meanwhile', async () => {
    const { alice, bob } = await importedAndEstimating();
    let release!: () => void;
    gw!.writeEstimate = () => new Promise<void>((r) => (release = r));
    const flow = agree(alice, bob);
    await new Promise((r) => setTimeout(r, 0));
    await act(alice, { type: 'reopen', ticketId: 't1' });
    release();
    await flow;
    expect(view(alice).tickets[0].status).toBe('voting');
    expect(view(alice).tickets[0].jira.writeStatus).toBe('none');
  });
});
