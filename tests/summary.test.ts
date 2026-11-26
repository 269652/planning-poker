import { describe, expect, it } from 'vitest';
import { applyAction, createRoom, type Action, type RoomState } from '@/core/room';
import { summarizeTicket } from '@/core/summary';

let clock = 1;
const run = (s: RoomState, a: string, act: Action) => applyAction(s, a, act, (clock += 10));

function agreedAfterThreeRounds(): RoomState {
  let s = createRoom('r', 'R', 1);
  s = run(s, 'a', { type: 'join', name: 'Ann' });
  s = run(s, 'b', { type: 'join', name: 'Ben' });
  s = run(s, 'a', { type: 'addTicket', ticket: { title: 'T', key: 'PP-9', source: 'jira' } });
  s = run(s, 'a', { type: 'selectTicket', ticketId: 't1' });
  for (const [x, y] of [[2, 13], [5, 8], [8, 8]] as const) {
    s = run(s, 'a', { type: 'vote', card: x });
    s = run(s, 'b', { type: 'vote', card: y });
    s = run(s, 'a', { type: 'reveal' });
    if (x !== 8) s = run(s, 'a', { type: 'revote' });
  }
  return run(s, 'a', { type: 'accept' });
}

describe('summarizeTicket', () => {
  it('describes the outcome, rounds and per-round votes', () => {
    const s = agreedAfterThreeRounds();
    const sum = summarizeTicket(s.tickets[0]);
    expect(sum.estimate).toBe(8);
    expect(sum.roundCount).toBe(3);
    expect(sum.lines[0]).toContain('8');
    expect(sum.lines[0]).toContain('3 rounds');
    expect(sum.lines[0]).toContain('consensus');
    expect(sum.lines.join('\n')).toMatch(/Round 1.*2.*13/);
    expect(sum.lines.join('\n')).toMatch(/Round 3.*8.*8/);
  });

  it('uses singular wording for one round and flags forced decisions', () => {
    let s = createRoom('r', 'R', 1);
    s = run(s, 'a', { type: 'join', name: 'Ann' });
    s = run(s, 'a', { type: 'addTicket', ticket: { title: 'T' } });
    s = run(s, 'a', { type: 'selectTicket', ticketId: 't1' });
    s = run(s, 'a', { type: 'vote', card: 3 });
    s = run(s, 'a', { type: 'reveal' });
    s = run(s, 'a', { type: 'accept' });
    expect(summarizeTicket(s.tickets[0]).lines[0]).toContain('1 round');
    expect(summarizeTicket(s.tickets[0]).lines[0]).not.toContain('1 rounds');
  });

  it('throws for tickets without an agreed estimate', () => {
    let s = createRoom('r', 'R', 1);
    s = run(s, 'a', { type: 'join', name: 'Ann' });
    s = run(s, 'a', { type: 'addTicket', ticket: { title: 'T' } });
    expect(() => summarizeTicket(s.tickets[0])).toThrow();
  });
});
