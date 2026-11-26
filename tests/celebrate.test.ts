import { describe, it, expect } from "vitest";
import { Room } from "@/core/room";
import { firstTryUnanimous } from "@/ui/celebrate";

function setup() {
  const room = Room.create({ id: "ABCD2345", name: "Party" });
  const host = room.join({ name: "Host" }).participant.id;
  const bob = room.join({ name: "Bob" }).participant.id;
  const ticket = room.addTicket(host, { title: "T" }).id;
  room.selectTicket(host, ticket);
  return { room, host, bob, ticket };
}

describe("firstTryUnanimous", () => {
  it("fires when everyone played the same card in the first round", () => {
    const { room, host, bob, ticket } = setup();
    room.vote(host, 5); room.vote(bob, 5);
    const before = room.view(host);
    room.reveal(host);
    expect(firstTryUnanimous(before, room.view(host))).toBe(ticket);
  });

  it("does not fire on disagreement, a single vote, or without a previous view", () => {
    const a = setup();
    a.room.vote(a.host, 5); a.room.vote(a.bob, 8);
    const before = a.room.view(a.host);
    a.room.reveal(a.host);
    expect(firstTryUnanimous(before, a.room.view(a.host))).toBeNull();
    expect(firstTryUnanimous(null, a.room.view(a.host))).toBeNull();

    const b = setup();
    b.room.vote(b.host, 3);
    const beforeB = b.room.view(b.host);
    b.room.reveal(b.host);
    expect(firstTryUnanimous(beforeB, b.room.view(b.host))).toBeNull();
  });

  it("does not fire when agreement only came in a later round, or again on re-render", () => {
    const { room, host, bob } = setup();
    room.vote(host, 5); room.vote(bob, 8);
    room.reveal(host);
    room.nextRound(host);
    room.vote(host, 5); room.vote(bob, 5);
    const before = room.view(host);
    room.reveal(host);
    const after = room.view(host);
    expect(firstTryUnanimous(before, after)).toBeNull();
    expect(firstTryUnanimous(after, after)).toBeNull();
  });
});
