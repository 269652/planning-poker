import { describe, expect, it } from 'vitest';
import { applyAction, createRoom, type Action, type RoomState } from '@/core/room';
import { viewFor } from '@/core/view';

let clock = 1000;
const run = (s: RoomState, a: string, act: Action) => applyAction(s, a, act, (clock += 10));

function setup() {
  let s = createRoom('r', 'Room', 1000);
  for (const [id, n] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol']]) s = run(s, id, { type: 'join', name: n });
  s = run(s, 'alice', { type: 'addTicket', ticket: { title: 'T', key: 'PP-1', source: 'jira' } });
  s = run(s, 'alice', { type: 'selectTicket', ticketId: 't1' });
  s = run(s, 'alice', { type: 'vote', card: 89 });
  s = run(s, 'bob', { type: 'vote', card: 55 });
  return s;
}

describe('viewFor', () => {
  it('hides other participants votes while voting but shows who has voted', () => {
    const v = viewFor(setup(), 'carol');
    const byId = Object.fromEntries(v.participants.map((p) => [p.id, p]));
    expect(byId.alice.hasVoted).toBe(true);
    expect(byId.alice.vote).toBeNull();
    expect(byId.bob.vote).toBeNull();
    expect(byId.carol.hasVoted).toBe(false);
    expect(v.tickets[0].rounds[0].votes).toBeNull();
    expect(v.tickets[0].rounds[0].stats).toBeNull();
  });

  it('shows a participant their own vote', () => {
    const v = viewFor(setup(), 'alice');
    expect(v.participants.find((p) => p.id === 'alice')!.vote).toBe(89);
    expect(v.participants.find((p) => p.id === 'bob')!.vote).toBeNull();
  });

  it('never leaks hidden votes anywhere in the serialized payload', () => {
    const json = JSON.stringify(viewFor(setup(), 'carol'));
    expect(json).not.toContain('89');
    expect(json).not.toContain('55');
  });

  it('reveals everything after reveal, including stats and convergence', () => {
    let s = run(setup(), 'carol', { type: 'vote', card: 55 });
    s = run(s, 'alice', { type: 'reveal' });
    const v = viewFor(s, 'carol');
    expect(v.participants.find((p) => p.id === 'alice')!.vote).toBe(89);
    expect(v.tickets[0].rounds[0].votes).toEqual({ alice: 89, bob: 55, carol: 55 });
    expect(v.tickets[0].rounds[0].stats!.max).toBe(89);
    expect(v.tickets[0].convergence.trend).toBe('first-round');
  });

  it('keeps completed rounds visible after a revote, hides the new one', () => {
    let s = run(setup(), 'carol', { type: 'vote', card: 55 });
    s = run(s, 'alice', { type: 'reveal' });
    s = run(s, 'alice', { type: 'revote' });
    s = run(s, 'bob', { type: 'vote', card: 34 });
    const v = viewFor(s, 'carol');
    expect(v.tickets[0].rounds[0].votes).not.toBeNull();
    expect(v.tickets[0].rounds[1].votes).toBeNull();
    expect(v.participants.find((p) => p.id === 'bob')!.vote).toBeNull();
    expect(v.participants.find((p) => p.id === 'bob')!.hasVoted).toBe(true);
  });

  it('tells the client who it is and who hosts', () => {
    const v = viewFor(setup(), 'bob');
    expect(v).toMatchObject({ you: 'bob', hostId: 'alice', currentTicketId: 't1', id: 'r', name: 'Room' });
  });
});
