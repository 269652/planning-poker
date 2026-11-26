import { describe, it, expect, beforeEach } from "vitest";
import { Room, RoomError } from "@/core/room";

function makeRoom() {
  let t = 1_000;
  let n = 0;
  const room = Room.create({ id: "ROOM01", name: "Sprint 42", now: () => (t += 10), newId: () => `id${++n}` });
  return room;
}

function codeOf(fn: () => unknown): string {
  try { fn(); } catch (e) { if (e instanceof RoomError) return e.code; throw e; }
  return "NO_ERROR";
}

describe("Room: participants", () => {
  it("the first joiner becomes host, later joiners do not", () => {
    const room = makeRoom();
    const a = room.join({ name: "Alice" });
    const b = room.join({ name: "Bob" });
    expect(room.view(a.participant.id).hostId).toBe(a.participant.id);
    expect(room.view(b.participant.id).participants.find((p) => p.id === b.participant.id)?.isHost).toBe(false);
  });

  it("rejoining with a token resumes the same participant", () => {
    const room = makeRoom();
    const a = room.join({ name: "Alice" });
    room.leave(a.participant.id);
    expect(room.view(a.participant.id).participants[0].connected).toBe(false);
    const again = room.join({ name: "Alice (new tab)", token: a.token });
    expect(again.participant.id).toBe(a.participant.id);
    expect(room.view(a.participant.id).participants).toHaveLength(1);
    expect(room.view(a.participant.id).participants[0].connected).toBe(true);
  });

  it("an unknown token creates a new participant", () => {
    const room = makeRoom();
    room.join({ name: "Alice" });
    const x = room.join({ name: "Mallory", token: "forged" });
    expect(room.view(x.participant.id).participants).toHaveLength(2);
  });

  it("never leaks tokens in views", () => {
    const room = makeRoom();
    const a = room.join({ name: "Alice" });
    expect(JSON.stringify(room.view(a.participant.id))).not.toContain(a.token);
  });

  it("trims names, rejects empty names", () => {
    const room = makeRoom();
    expect(room.join({ name: "  Alice  " }).participant.name).toBe("Alice");
    expect(codeOf(() => room.join({ name: "   " }))).toBe("INVALID");
  });

  it("the host role stays with the room's owner (the browser that runs it)", () => {
    const room = makeRoom();
    room.join({ name: "A" });
    expect("promote" in room).toBe(false);
  });

  it("generates ids with the Web Crypto API (runs in browsers, no node:crypto)", () => {
    const room = Room.create({ id: "ROOMWC", name: "x" });
    const { participant, token } = room.join({ name: "A" });
    expect(participant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token).not.toBe(participant.id);
  });
});

describe("Room: ticket and round lifecycle", () => {
  let room: Room;
  let host: string, bob: string, cara: string, obs: string;

  beforeEach(() => {
    room = makeRoom();
    host = room.join({ name: "Host" }).participant.id;
    bob = room.join({ name: "Bob" }).participant.id;
    cara = room.join({ name: "Cara" }).participant.id;
    obs = room.join({ name: "Olga", role: "observer" }).participant.id;
  });

  const addAndSelect = (title = "Login page") => {
    const t = room.addTicket(host, { title });
    room.selectTicket(host, t.id);
    return t;
  };

  it("only the host can add, select and remove tickets", () => {
    expect(codeOf(() => room.addTicket(bob, { title: "x" }))).toBe("FORBIDDEN");
    const t = room.addTicket(host, { title: "x" });
    expect(codeOf(() => room.selectTicket(bob, t.id))).toBe("FORBIDDEN");
    expect(codeOf(() => room.removeTicket(bob, t.id))).toBe("FORBIDDEN");
  });

  it("selecting a ticket opens round 1 in voting state", () => {
    const t = addAndSelect();
    const v = room.view(host);
    expect(v.currentTicketId).toBe(t.id);
    const tv = v.tickets[0];
    expect(tv.rounds).toHaveLength(1);
    expect(tv.rounds[0]).toMatchObject({ number: 1, status: "voting" });
  });

  it("voting needs a current ticket", () => {
    expect(codeOf(() => room.vote(bob, 5))).toBe("NO_TICKET");
  });

  it("rejects invalid cards and observers voting", () => {
    addAndSelect();
    expect(codeOf(() => room.vote(bob, 4 as never))).toBe("INVALID");
    expect(codeOf(() => room.vote(obs, 5))).toBe("FORBIDDEN");
  });

  it("hides other people's votes until reveal, but shows your own", () => {
    addAndSelect();
    room.vote(bob, 8);
    room.vote(cara, "?");
    const bobView = room.view(bob).tickets[0].rounds[0];
    expect(bobView.myVote).toBe(8);
    expect(bobView.votes).toBeNull();
    expect(bobView.stats).toBeNull();
    expect(bobView.voted.sort()).toEqual([bob, cara].sort());
    const hostView = room.view(host).tickets[0].rounds[0];
    expect(hostView.myVote).toBeNull();
    expect(JSON.stringify(room.view(host))).not.toContain('"8"');
    expect(hostView.votes).toBeNull();
    const p = room.view(host).participants.find((x) => x.id === bob)!;
    expect(p.hasVoted).toBe(true);
    expect(room.view(host).participants.find((x) => x.id === host)!.hasVoted).toBe(false);
  });

  it("allows changing a vote before reveal", () => {
    addAndSelect();
    room.vote(bob, 3);
    room.vote(bob, 5);
    room.reveal(host);
    expect(room.view(host).tickets[0].rounds[0].votes![bob]).toBe(5);
  });

  it("only the host can reveal, and not without votes", () => {
    addAndSelect();
    room.vote(bob, 3);
    expect(codeOf(() => room.reveal(bob))).toBe("FORBIDDEN");
    const empty = makeRoom();
    const h = empty.join({ name: "H" }).participant.id;
    const t = empty.addTicket(h, { title: "t" });
    empty.selectTicket(h, t.id);
    expect(codeOf(() => empty.reveal(h))).toBe("NO_VOTES");
  });

  it("reveal exposes votes and computes statistics", () => {
    addAndSelect();
    room.vote(host, 5);
    room.vote(bob, 8);
    room.vote(cara, 8);
    room.reveal(host);
    const r = room.view(bob).tickets[0].rounds[0];
    expect(r.status).toBe("revealed");
    expect(r.votes).toEqual({ [host]: 5, [bob]: 8, [cara]: 8 });
    expect(r.stats).toMatchObject({ min: 5, max: 8, modeCard: 8, spreadSteps: 1, agreed: false });
  });

  it("cannot vote after reveal", () => {
    addAndSelect();
    room.vote(bob, 5);
    room.reveal(host);
    expect(codeOf(() => room.vote(cara, 5))).toBe("BAD_PHASE");
  });

  it("nextRound requires a revealed round and records a new voting round", () => {
    addAndSelect();
    expect(codeOf(() => room.nextRound(host))).toBe("BAD_PHASE");
    room.vote(bob, 3);
    room.vote(cara, 13);
    room.reveal(host);
    room.nextRound(host);
    const t = room.view(host).tickets[0];
    expect(t.rounds.map((r) => [r.number, r.status])).toEqual([[1, "revealed"], [2, "voting"]]);
    expect(t.rounds[0].votes).not.toBeNull(); // history stays visible
    expect(t.rounds[1].votes).toBeNull();
    expect(t.rounds[1].voted).toEqual([]);
  });

  it("records convergence across rounds", () => {
    addAndSelect();
    room.vote(bob, 1); room.vote(cara, 21); room.reveal(host); room.nextRound(host);
    room.vote(bob, 5); room.vote(cara, 8); room.reveal(host);
    expect(room.view(host).tickets[0].convergence.trend).toBe("converging");
    room.nextRound(host);
    room.vote(bob, 8); room.vote(cara, 8); room.reveal(host);
    const c = room.view(host).tickets[0].convergence;
    expect(c.trend).toBe("agreed");
    expect(c.roundsToAgreement).toBe(3);
    expect(c.scores).toHaveLength(3);
  });

  it("finalize with agreement stores the estimate and closes the ticket", () => {
    const t = addAndSelect();
    room.vote(bob, 8); room.vote(cara, 8);
    room.reveal(host);
    const done = room.finalize(host);
    expect(done).toMatchObject({ id: t.id, status: "estimated", estimate: 8, resolution: "agreement" });
    expect(room.view(host).tickets[0]).toMatchObject({ status: "estimated", estimate: 8 });
  });

  it("finalize without agreement requires an explicit override value", () => {
    addAndSelect();
    room.vote(bob, 3); room.vote(cara, 13);
    room.reveal(host);
    expect(codeOf(() => room.finalize(host))).toBe("NO_AGREEMENT");
    expect(codeOf(() => room.finalize(host, 4 as never))).toBe("INVALID");
    expect(codeOf(() => room.finalize(host, "?" as never))).toBe("INVALID");
    const done = room.finalize(host, 8);
    expect(done).toMatchObject({ estimate: 8, resolution: "override" });
  });

  it("only the host can finalize, and only after reveal", () => {
    addAndSelect();
    room.vote(bob, 5);
    expect(codeOf(() => room.finalize(host, 5))).toBe("BAD_PHASE");
    room.reveal(host);
    expect(codeOf(() => room.finalize(bob, 5))).toBe("FORBIDDEN");
  });

  it("the adjacent rule changes what counts as agreement", () => {
    room.setRule(host, "adjacent");
    addAndSelect();
    room.vote(bob, 5); room.vote(cara, 8);
    room.reveal(host);
    expect(room.finalize(host)).toMatchObject({ estimate: 8, resolution: "agreement" });
  });

  it("the rule is stored per round at reveal time (history is not rewritten)", () => {
    addAndSelect();
    room.vote(bob, 5); room.vote(cara, 8);
    room.reveal(host);
    room.setRule(host, "adjacent");
    expect(room.view(host).tickets[0].rounds[0].stats!.agreed).toBe(false);
  });

  it("reopen starts a fresh round on an estimated ticket and keeps history", () => {
    const t = addAndSelect();
    room.vote(bob, 8); room.vote(cara, 8); room.reveal(host); room.finalize(host);
    room.reopen(host, t.id);
    const tv = room.view(host).tickets[0];
    expect(tv.status).toBe("open");
    expect(tv.estimate).toBeNull();
    expect(tv.rounds).toHaveLength(2);
    expect(tv.rounds[1].status).toBe("voting");
    expect(room.view(host).currentTicketId).toBe(t.id);
  });

  it("switching tickets mid-round keeps the unfinished round and its hidden votes", () => {
    const t1 = addAndSelect("T1");
    room.vote(bob, 5);
    const t2 = room.addTicket(host, { title: "T2" });
    room.selectTicket(host, t2.id);
    expect(room.view(host).currentTicketId).toBe(t2.id);
    room.selectTicket(host, t1.id);
    expect(room.view(bob).tickets[0].rounds[0].myVote).toBe(5);
    expect(room.view(host).tickets[0].rounds[0].votes).toBeNull();
  });

  it("removing the current ticket clears the selection", () => {
    const t = addAndSelect();
    room.removeTicket(host, t.id);
    expect(room.view(host).currentTicketId).toBeNull();
    expect(room.view(host).tickets).toHaveLength(0);
  });

  it("stores Jira metadata and writeback state on tickets", () => {
    const t = room.addTicket(host, {
      title: "From Jira", key: "PROJ-7", source: "jira", url: "https://j/browse/PROJ-7", currentEstimate: 3,
    });
    expect(t).toMatchObject({ key: "PROJ-7", source: "jira", currentEstimate: 3, writeback: { status: "none" } });
    room.setWriteback(t.id, { status: "failed", error: "boom" });
    expect(room.view(host).tickets[0].writeback).toMatchObject({ status: "failed", error: "boom" });
  });

  it("keeps the Jira issue type and status for display", () => {
    const t = room.addTicket(host, { title: "x", key: "PROJ-8", source: "jira", issueType: "Bug", jiraStatus: "In Progress" });
    expect(t).toMatchObject({ issueType: "Bug", status: "open", jiraStatus: "In Progress" });
  });

  it("does not add the same Jira key twice", () => {
    room.addTicket(host, { title: "a", key: "PROJ-1", source: "jira" });
    expect(codeOf(() => room.addTicket(host, { title: "a", key: "PROJ-1", source: "jira" }))).toBe("DUPLICATE");
  });
});

describe("Room: persistence", () => {
  it("round-trips through snapshot/restore including tokens", () => {
    const room = makeRoom();
    const a = room.join({ name: "A" });
    const b = room.join({ name: "B" });
    const t = room.addTicket(a.participant.id, { title: "t" });
    room.selectTicket(a.participant.id, t.id);
    room.vote(b.participant.id, 5);
    const copy = Room.restore(JSON.parse(JSON.stringify(room.snapshot())));
    expect(copy.view(b.participant.id)).toEqual(room.view(b.participant.id));
    const resumed = copy.join({ name: "B", token: b.token });
    expect(resumed.participant.id).toBe(b.participant.id);
  });

  it("restores rooms saved before boards existed (board defaults to null)", () => {
    const room = makeRoom();
    const a = room.join({ name: "A" });
    const old = room.snapshot() as unknown as Record<string, unknown>;
    delete old.board;
    expect(Room.restore(old as never).view(a.participant.id).board).toBeNull();
  });
});

describe("Room: Jira board", () => {
  it("is bound to an optional board, visible in views and snapshots", () => {
    const board = { id: 7, name: "Team Board", type: "kanban" };
    const room = Room.create({ id: "ROOM02", name: "Refinement", board });
    const a = room.join({ name: "A" }).participant.id;
    expect(room.view(a).board).toEqual(board);
    expect(room.board).toEqual(board);
    expect(Room.restore(room.snapshot()).view(a).board).toEqual(board);
    expect(makeRoom().view(makeRoom().join({ name: "x" }).participant.id).board).toBeNull();
  });
});

describe("Room: estimating one ticket after another", () => {
  let room: Room;
  let host: string, bob: string;
  beforeEach(() => {
    room = makeRoom();
    host = room.join({ name: "Host" }).participant.id;
    bob = room.join({ name: "Bob" }).participant.id;
  });
  const estimate = (card: 3 | 5) => { room.vote(host, card); room.vote(bob, card); room.reveal(host); room.finalize(host); };

  it("nextTicket moves to the next open ticket in list order and opens its first round", () => {
    const [a, b, c] = ["A", "B", "C"].map((title) => room.addTicket(host, { title }));
    room.selectTicket(host, a.id);
    estimate(3);
    room.nextTicket(host);
    expect(room.view(host).currentTicketId).toBe(b.id);
    expect(room.view(host).tickets[1].rounds).toHaveLength(1);
    room.nextTicket(host); // skipping an unestimated ticket is allowed
    expect(room.view(host).currentTicketId).toBe(c.id);
  });

  it("nextTicket skips estimated tickets and wraps around", () => {
    const [a, b, c] = ["A", "B", "C"].map((title) => room.addTicket(host, { title }));
    room.selectTicket(host, b.id); estimate(5);
    room.selectTicket(host, c.id);
    room.nextTicket(host);
    expect(room.view(host).currentTicketId).toBe(a.id);
  });

  it("nextTicket with no selection starts at the first open ticket", () => {
    const [a, b] = ["A", "B"].map((title) => room.addTicket(host, { title }));
    room.selectTicket(host, a.id); estimate(3);
    room.removeTicket(host, a.id);
    room.nextTicket(host);
    expect(room.view(host).currentTicketId).toBe(b.id);
  });

  it("nextTicket reports NO_TICKET when nothing else is open, and is host-only", () => {
    const a = room.addTicket(host, { title: "A" });
    expect(codeOf(() => room.nextTicket(bob))).toBe("FORBIDDEN");
    room.selectTicket(host, a.id); estimate(3);
    expect(codeOf(() => room.nextTicket(host))).toBe("NO_TICKET");
    expect(room.view(host).currentTicketId).toBe(a.id);
  });
});

describe("Room: card patterns (who picked the same card is visible, not which card)", () => {
  let room: Room;
  let host: string, bob: string, cara: string, obs: string;
  beforeEach(() => {
    room = makeRoom();
    host = room.join({ name: "Host" }).participant.id;
    bob = room.join({ name: "Bob" }).participant.id;
    cara = room.join({ name: "Cara" }).participant.id;
    obs = room.join({ name: "Olga", role: "observer" }).participant.id;
    room.selectTicket(host, room.addTicket(host, { title: "T" }).id);
  });
  const patterns = (pid = obs) => room.view(pid).tickets[0].rounds.at(-1)!.patterns;

  it("equal cards share a pattern id, different cards get different ones, before reveal", () => {
    room.vote(host, 5); room.vote(bob, 5); room.vote(cara, 8);
    const p = patterns();
    expect(Object.keys(p).sort()).toEqual([bob, cara, host].sort());
    expect(p[host]).toBe(p[bob]);
    expect(p[cara]).not.toBe(p[host]);
    expect(patterns(bob)).toEqual(p);
  });

  it("pattern ids carry no information about the card", () => {
    room.vote(host, 5); room.vote(bob, 13);
    // Ids come from the room's random id generator (UUIDs in production), not from the card.
    for (const id of Object.values(patterns())) expect(id).toMatch(/^id\d+$/);
    expect(Object.values(patterns())).not.toContain("5");
    expect(Object.values(patterns())).not.toContain("13");
    expect(JSON.stringify(room.view(obs).tickets[0].rounds[0].votes)).toBe("null");
  });

  it("every round gets new patterns, and changing a vote changes your pattern", () => {
    room.vote(host, 5); room.vote(bob, 8);
    const first = patterns()[host];
    room.vote(bob, 5);
    expect(patterns()[bob]).toBe(first);
    room.reveal(host);
    room.nextRound(host);
    room.vote(host, 5);
    expect(patterns()[host]).not.toBe(first);
  });

  it("rooms saved before patterns existed still show votes without patterns", () => {
    room.vote(host, 5);
    const state = JSON.parse(JSON.stringify(room.snapshot()));
    delete state.tickets[0].rounds[0].patternIds;
    const back = Room.restore(state);
    expect(back.view(host).tickets[0].rounds[0].patterns).toEqual({});
    back.vote(bob, 5);
    const p = back.view(host).tickets[0].rounds[0].patterns;
    expect(Object.keys(p).sort()).toEqual([bob, host].sort());
    expect(p[bob]).toBe(p[host]);
  });
});

describe("Room: pinging people who haven't voted", () => {
  let room: Room;
  let t: number;
  let host: string, bob: string, cara: string, obs: string;
  beforeEach(() => {
    t = 1_000_000;
    let n = 0;
    room = Room.create({ id: "ROOM01", name: "R", now: () => t, newId: () => `id${++n}` });
    host = room.join({ name: "Host" }).participant.id;
    bob = room.join({ name: "Bob" }).participant.id;
    cara = room.join({ name: "Cara" }).participant.id;
    obs = room.join({ name: "Olga", role: "observer" }).participant.id;
    room.selectTicket(host, room.addTicket(host, { title: "T" }).id);
  });

  it("pings every connected voter who hasn't voted yet (never the sender or observers)", () => {
    room.vote(bob, 5);
    expect(room.nudge(host)).toEqual({ from: "Host", targets: [cara] });
    t += 10_000;
    expect(room.nudge(obs).targets.sort()).toEqual([cara, host].sort());
  });

  it("can ping one person, but only someone who still has to vote", () => {
    expect(room.nudge(bob, cara)).toEqual({ from: "Bob", targets: [cara] });
    room.vote(cara, 3);
    t += 10_000;
    expect(codeOf(() => room.nudge(bob, cara))).toBe("INVALID");
    expect(codeOf(() => room.nudge(bob, obs))).toBe("INVALID");
    expect(codeOf(() => room.nudge(bob, "nobody"))).toBe("NOT_FOUND");
  });

  it("skips disconnected people and reports when nobody is left to ping", () => {
    room.leave(cara);
    room.vote(bob, 5);
    room.vote(host, 5);
    expect(codeOf(() => room.nudge(host))).toBe("INVALID");
  });

  it("only while voting, and at most once every 10 seconds per sender", () => {
    expect(room.nudge(host).targets.length).toBe(2);
    expect(codeOf(() => room.nudge(host))).toBe("RATE_LIMITED");
    expect(room.nudge(bob).targets.length).toBe(2);
    t += 10_000;
    room.vote(bob, 5);
    room.reveal(host);
    expect(codeOf(() => room.nudge(host))).toBe("BAD_PHASE");
  });
});

describe("Room: raising a hand", () => {
  it("anyone can raise and lower their hand; it is visible to all", () => {
    const room = makeRoom();
    const host = room.join({ name: "Host" }).participant.id;
    const bob = room.join({ name: "Bob" }).participant.id;
    room.raiseHand(bob, true);
    expect(room.view(host).participants.find((p) => p.id === bob)!.handRaised).toBe(true);
    room.raiseHand(bob, false);
    expect(room.view(host).participants.find((p) => p.id === bob)!.handRaised).toBe(false);
  });

  it("hands are lowered when the team moves on to a new round or ticket", () => {
    const room = makeRoom();
    const host = room.join({ name: "Host" }).participant.id;
    const bob = room.join({ name: "Bob" }).participant.id;
    const [a, b] = ["A", "B"].map((title) => room.addTicket(host, { title }));
    room.selectTicket(host, a.id);
    room.raiseHand(bob, true);
    room.vote(bob, 3); room.reveal(host); room.nextRound(host);
    expect(room.view(host).participants[1].handRaised).toBe(false);
    room.raiseHand(bob, true);
    room.selectTicket(host, b.id);
    expect(room.view(host).participants[1].handRaised).toBe(false);
  });

  it("unknown participants cannot raise a hand", () => {
    expect(codeOf(() => makeRoom().raiseHand("nobody", true))).toBe("NOT_FOUND");
  });
});

describe("Room: summary for the landing page", () => {
  it("summarises progress, presence and role without exposing votes or tokens", () => {
    const room = Room.create({ id: "ROOM03", name: "Planning", board: { id: 1, name: "B", type: "scrum" }, now: () => 5_000 });
    const host = room.join({ name: "Host" }).participant.id;
    const bob = room.join({ name: "Bob" }).participant.id;
    const t1 = room.addTicket(host, { title: "One", key: "P-1", source: "jira" });
    room.addTicket(host, { title: "Two" });
    room.selectTicket(host, t1.id);
    room.vote(bob, 5);
    room.leave(bob);
    const s = room.summary(bob);
    expect(s).toEqual({
      id: "ROOM03", name: "Planning", board: { id: 1, name: "B", type: "scrum" },
      isHost: false, ticketCount: 2, estimatedCount: 0, online: 1, participantCount: 2,
      current: { key: "P-1", title: "One" }, createdAt: 5_000, lastActivityAt: 5_000,
    });
    expect(room.summary(host).isHost).toBe(true);
    expect(JSON.stringify(s)).not.toContain("token");
  });
});
