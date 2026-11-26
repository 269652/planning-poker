import { describe, expect, it } from 'vitest';
import { RoomError, SYSTEM, applyAction, createRoom, type Action, type RoomState } from '@/core/room';

const T = 1_000;
let clock = T;
const tick = () => (clock += 10);

function run(s: RoomState, actor: string, a: Action): RoomState {
  return applyAction(s, actor, a, tick());
}
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof RoomError) return e.code;
    throw e;
  }
  return 'no-error';
}

function lobby(): RoomState {
  let s = createRoom('r1', 'Sprint 42', T);
  s = run(s, 'alice', { type: 'join', name: 'Alice' });
  s = run(s, 'bob', { type: 'join', name: 'Bob' });
  s = run(s, 'carol', { type: 'join', name: 'Carol' });
  return s;
}
function withTicket(s = lobby()): RoomState {
  s = run(s, 'alice', { type: 'addTicket', ticket: { title: 'Login page', key: 'PP-1', source: 'jira' } });
  return s;
}
function voting(): RoomState {
  const s = withTicket();
  return run(s, 'alice', { type: 'selectTicket', ticketId: s.tickets[0].id });
}
function allVote(s: RoomState, votes: Record<string, any>): RoomState {
  for (const [id, card] of Object.entries(votes)) s = run(s, id, { type: 'vote', card });
  return s;
}
const cur = (s: RoomState) => s.tickets.find((t) => t.id === s.currentTicketId)!;

describe('joining', () => {
  it('first participant becomes host, others are voters', () => {
    const s = lobby();
    expect(s.hostId).toBe('alice');
    expect(s.participants.bob.role).toBe('voter');
    expect(s.participants.bob.connected).toBe(true);
  });

  it('rejoining keeps role and reconnects', () => {
    let s = lobby();
    s = run(s, 'bob', { type: 'setRole', role: 'observer' });
    s = run(s, 'bob', { type: 'disconnect' });
    expect(s.participants.bob.connected).toBe(false);
    s = run(s, 'bob', { type: 'join', name: 'Bobby' });
    expect(s.participants.bob).toMatchObject({ connected: true, role: 'observer', name: 'Bobby' });
  });

  it('rejects empty names and trims long ones', () => {
    const s = createRoom('r', 'x', T);
    expect(codeOf(() => run(s, 'a', { type: 'join', name: '   ' }))).toBe('invalid');
    const s2 = run(s, 'a', { type: 'join', name: 'x'.repeat(100) });
    expect(s2.participants.a.name.length).toBe(40);
  });

  it('host can transfer host role, others cannot', () => {
    let s = lobby();
    expect(codeOf(() => run(s, 'bob', { type: 'transferHost', to: 'bob' }))).toBe('forbidden');
    s = run(s, 'alice', { type: 'transferHost', to: 'bob' });
    expect(s.hostId).toBe('bob');
    expect(codeOf(() => run(s, 'alice', { type: 'transferHost', to: 'ghost' }))).toBe('forbidden');
  });

  it('host identity survives a disconnect (no automatic reassignment)', () => {
    let s = lobby();
    s = run(s, 'alice', { type: 'disconnect' });
    expect(s.hostId).toBe('alice');
  });
});

describe('tickets', () => {
  it('only host adds tickets; ids are deterministic', () => {
    const s = lobby();
    expect(codeOf(() => run(s, 'bob', { type: 'addTicket', ticket: { title: 't' } }))).toBe('forbidden');
    const s2 = run(s, 'alice', { type: 'addTicket', ticket: { title: 'One' } });
    const s3 = run(s2, 'alice', { type: 'addTicket', ticket: { title: 'Two' } });
    expect(s3.tickets.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(s3.tickets[0]).toMatchObject({ status: 'pending', source: 'manual', estimate: null, rounds: [] });
  });

  it('rejects blank titles', () => {
    expect(codeOf(() => run(lobby(), 'alice', { type: 'addTicket', ticket: { title: ' ' } }))).toBe('invalid');
  });

  it('import dedupes by key and refreshes metadata without losing rounds', () => {
    let s = run(lobby(), 'alice', {
      type: 'importTickets',
      tickets: [
        { key: 'PP-1', title: 'A', source: 'jira', currentEstimate: null },
        { key: 'PP-2', title: 'B', source: 'jira', currentEstimate: 3 },
      ],
    });
    expect(s.tickets).toHaveLength(2);
    expect(s.tickets[1].currentEstimate).toBe(3);
    s = run(s, 'alice', { type: 'selectTicket', ticketId: 't1' });
    s = run(s, 'alice', { type: 'importTickets', tickets: [{ key: 'PP-1', title: 'A renamed', source: 'jira' }, { key: 'PP-3', title: 'C', source: 'jira' }] });
    expect(s.tickets.map((t) => t.key)).toEqual(['PP-1', 'PP-2', 'PP-3']);
    expect(s.tickets[0].title).toBe('A renamed');
    expect(s.tickets[0].rounds).toHaveLength(1);
  });

  it('removes tickets and clears the current pointer', () => {
    let s = voting();
    s = run(s, 'alice', { type: 'removeTicket', ticketId: 't1' });
    expect(s.tickets).toHaveLength(0);
    expect(s.currentTicketId).toBeNull();
  });

  it('selecting a pending ticket starts round 1', () => {
    const s = voting();
    expect(s.currentTicketId).toBe('t1');
    expect(cur(s).status).toBe('voting');
    expect(cur(s).rounds).toHaveLength(1);
    expect(cur(s).rounds[0]).toMatchObject({ number: 1, revealedAt: null, stats: null });
  });

  it('selecting an agreed ticket requires reopen', () => {
    let s = allVote(voting(), { alice: 5, bob: 5, carol: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    s = run(s, 'alice', { type: 'accept' });
    expect(codeOf(() => run(s, 'alice', { type: 'selectTicket', ticketId: 't1' }))).toBe('invalid_state');
  });

  it('switching tickets keeps in-flight rounds so they can be resumed', () => {
    let s = voting();
    s = run(s, 'alice', { type: 'addTicket', ticket: { title: 'Second' } });
    s = run(s, 'alice', { type: 'vote', card: 3 });
    s = run(s, 'alice', { type: 'selectTicket', ticketId: 't2' });
    expect(cur(s).id).toBe('t2');
    s = run(s, 'alice', { type: 'selectTicket', ticketId: 't1' });
    expect(cur(s).rounds[0].votes.alice).toBe(3);
  });
});

describe('voting', () => {
  it('records and changes votes before reveal, and retracts', () => {
    let s = voting();
    s = run(s, 'bob', { type: 'vote', card: 5 });
    s = run(s, 'bob', { type: 'vote', card: 8 });
    expect(cur(s).rounds[0].votes.bob).toBe(8);
    s = run(s, 'bob', { type: 'retract' });
    expect(cur(s).rounds[0].votes.bob).toBeUndefined();
  });

  it('rejects invalid cards, observers, missing ticket and votes after reveal', () => {
    const idle = lobby();
    expect(codeOf(() => run(idle, 'bob', { type: 'vote', card: 5 }))).toBe('invalid_state');
    let s = voting();
    expect(codeOf(() => run(s, 'bob', { type: 'vote', card: 4 as any }))).toBe('invalid');
    s = run(s, 'carol', { type: 'setRole', role: 'observer' });
    expect(codeOf(() => run(s, 'carol', { type: 'vote', card: 5 }))).toBe('forbidden');
    s = run(s, 'bob', { type: 'vote', card: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    expect(codeOf(() => run(s, 'bob', { type: 'vote', card: 8 }))).toBe('invalid_state');
  });

  it('switching to observer drops an existing vote', () => {
    let s = voting();
    s = run(s, 'bob', { type: 'vote', card: 5 });
    s = run(s, 'bob', { type: 'setRole', role: 'observer' });
    expect(cur(s).rounds[0].votes.bob).toBeUndefined();
  });

  it('host may change another participant role; others may not', () => {
    const s = lobby();
    expect(codeOf(() => run(s, 'bob', { type: 'setRole', role: 'observer', target: 'carol' }))).toBe('forbidden');
    expect(run(s, 'alice', { type: 'setRole', role: 'observer', target: 'carol' }).participants.carol.role).toBe('observer');
  });
});

describe('reveal', () => {
  it('only host reveals, needs at least one vote, and snapshots voters + stats', () => {
    let s = voting();
    expect(codeOf(() => run(s, 'alice', { type: 'reveal' }))).toBe('invalid_state');
    s = allVote(s, { alice: 3, bob: 5 });
    expect(codeOf(() => run(s, 'bob', { type: 'reveal' }))).toBe('forbidden');
    s = run(s, 'alice', { type: 'reveal' });
    const r = cur(s).rounds[0];
    expect(cur(s).status).toBe('revealed');
    expect(r.revealedAt).not.toBeNull();
    expect(r.voters.map((v) => v.id).sort()).toEqual(['alice', 'bob', 'carol']);
    expect(r.stats).toMatchObject({ voted: 2, voters: 3, consensus: false });
  });

  it('auto-reveals once every eligible voter has voted (when enabled)', () => {
    let s = run(voting(), 'alice', { type: 'setSettings', autoReveal: true });
    s = allVote(s, { alice: 5, bob: 5 });
    expect(cur(s).status).toBe('voting');
    s = run(s, 'carol', { type: 'vote', card: 8 });
    expect(cur(s).status).toBe('revealed');
  });

  it('disconnected voters who did not vote are not awaited; observers never are', () => {
    let s = run(voting(), 'alice', { type: 'setSettings', autoReveal: true });
    s = run(s, 'carol', { type: 'disconnect' });
    s = allVote(s, { alice: 5, bob: 5 });
    expect(cur(s).status).toBe('revealed');
    expect(cur(s).rounds[0].stats!.consensus).toBe(true);
  });

  it('observers do not count towards consensus', () => {
    let s = run(voting(), 'carol', { type: 'setRole', role: 'observer' });
    s = allVote(s, { alice: 5, bob: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    expect(cur(s).rounds[0].stats!.consensus).toBe(true);
  });
});

describe('rounds and agreement', () => {
  function disagreeing() {
    let s = allVote(voting(), { alice: 2, bob: 8, carol: 13 });
    return run(s, 'alice', { type: 'reveal' });
  }

  it('revote opens round 2 and keeps history', () => {
    let s = disagreeing();
    s = run(s, 'alice', { type: 'revote' });
    expect(cur(s).status).toBe('voting');
    expect(cur(s).rounds.map((r) => r.number)).toEqual([1, 2]);
    expect(cur(s).rounds[0].votes).toEqual({ alice: 2, bob: 8, carol: 13 });
    expect(cur(s).rounds[1].votes).toEqual({});
  });

  it('revote during voting clears the current round instead of adding one', () => {
    let s = allVote(voting(), { alice: 2 });
    s = run(s, 'alice', { type: 'revote' });
    expect(cur(s).rounds).toHaveLength(1);
    expect(cur(s).rounds[0].votes).toEqual({});
  });

  it('records convergence across multiple rounds until agreement', () => {
    let s = disagreeing();
    s = run(s, 'alice', { type: 'revote' });
    s = allVote(s, { alice: 5, bob: 8, carol: 8 });
    s = run(s, 'alice', { type: 'reveal' });
    s = run(s, 'alice', { type: 'revote' });
    s = allVote(s, { alice: 8, bob: 8, carol: 8 });
    s = run(s, 'alice', { type: 'reveal' });
    const spreads = cur(s).rounds.map((r) => r.stats!.spreadSteps);
    expect(spreads).toEqual([4, 1, 0]);
    s = run(s, 'alice', { type: 'accept' });
    expect(cur(s)).toMatchObject({ status: 'agreed', estimate: 8, resolution: 'consensus' });
    expect(cur(s).agreedAt).not.toBeNull();
  });

  it('accept without consensus needs an explicit card and is marked forced', () => {
    let s = disagreeing();
    expect(codeOf(() => run(s, 'alice', { type: 'accept' }))).toBe('no_consensus');
    expect(codeOf(() => run(s, 'alice', { type: 'accept', value: 4 as any }))).toBe('invalid');
    expect(codeOf(() => run(s, 'alice', { type: 'accept', value: '?' as any }))).toBe('invalid');
    expect(codeOf(() => run(s, 'bob', { type: 'accept', value: 8 }))).toBe('forbidden');
    s = run(s, 'alice', { type: 'accept', value: 8 });
    expect(cur(s)).toMatchObject({ status: 'agreed', estimate: 8, resolution: 'forced' });
  });

  it('accept with consensus refuses a different value', () => {
    let s = allVote(voting(), { alice: 5, bob: 5, carol: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    expect(codeOf(() => run(s, 'alice', { type: 'accept', value: 8 }))).toBe('invalid');
  });

  it('accept only after reveal', () => {
    expect(codeOf(() => run(voting(), 'alice', { type: 'accept', value: 5 }))).toBe('invalid_state');
  });

  it('reopen turns an agreed ticket back into voting with a new round', () => {
    let s = allVote(voting(), { alice: 5, bob: 5, carol: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    s = run(s, 'alice', { type: 'accept' });
    s = run(s, 'alice', { type: 'reopen', ticketId: 't1' });
    expect(cur(s)).toMatchObject({ status: 'voting', estimate: null, resolution: null });
    expect(cur(s).rounds.map((r) => r.number)).toEqual([1, 2]);
  });

  it('skip marks the ticket skipped and clears current', () => {
    const s = run(voting(), 'alice', { type: 'skip' });
    expect(s.tickets[0].status).toBe('skipped');
    expect(s.currentTicketId).toBeNull();
  });
});

describe('jira write-back state', () => {
  function agreed() {
    let s = allVote(voting(), { alice: 5, bob: 5, carol: 5 });
    s = run(s, 'alice', { type: 'reveal' });
    return run(s, 'alice', { type: 'accept' });
  }

  it('tracks pending -> written and pending -> failed (system actions only)', () => {
    let s = agreed();
    expect(codeOf(() => run(s, 'alice', { type: 'jiraWriteStart', ticketId: 't1' }))).toBe('forbidden');
    s = applyAction(s, SYSTEM, { type: 'jiraWriteStart', ticketId: 't1' }, tick());
    expect(s.tickets[0].jira.writeStatus).toBe('pending');
    const ok = applyAction(s, SYSTEM, { type: 'jiraWriteResult', ticketId: 't1', ok: true }, tick());
    expect(ok.tickets[0].jira).toMatchObject({ writeStatus: 'written', error: null });
    expect(ok.tickets[0].jira.writtenAt).not.toBeNull();
    const bad = applyAction(s, SYSTEM, { type: 'jiraWriteResult', ticketId: 't1', ok: false, error: 'boom' }, tick());
    expect(bad.tickets[0].jira).toMatchObject({ writeStatus: 'failed', error: 'boom' });
  });

  it('does not mutate previous state', () => {
    const before = voting();
    const snapshot = JSON.stringify(before);
    run(before, 'bob', { type: 'vote', card: 5 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
