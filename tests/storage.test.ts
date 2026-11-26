import { describe, it, expect } from "vitest";
import { Room } from "@/core/room";
import { LocalStore } from "@/ui/storage";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

describe("LocalStore (rooms live in the host's browser)", () => {
  it("saves and restores hosted rooms; restored participants start offline", () => {
    const store = new LocalStore(new MemoryStorage());
    const room = Room.create({ id: "ROOM2345", name: "Hosted", board: { id: 1, name: "B", type: "scrum" } });
    const me = room.join({ name: "Me" });
    store.saveHostedRoom(room.snapshot());
    const back = store.loadHostedRoom("ROOM2345")!;
    expect(back.view(me.participant.id).participants[0].connected).toBe(false);
    expect(back.authenticate(me.token)).toBe(me.participant.id);
    expect(store.isHosting("ROOM2345")).toBe(true);
    expect(store.isHosting("OTHER234")).toBe(false);
  });

  it("lists hosted and joined sessions, most recent first; forget removes both kinds", () => {
    const s = new MemoryStorage();
    const store = new LocalStore(s);
    const room = Room.create({ id: "HOST2345", name: "Mine", now: () => 1_000 });
    const me = room.join({ name: "Me" });
    store.setToken("HOST2345", me.token);
    store.saveHostedRoom(room.snapshot());
    store.rememberJoined({ id: "GUES2345", name: "Theirs", board: { id: 2, name: "K", type: "kanban" }, seenAt: 5_000, ticketCount: 4, estimatedCount: 1 });
    s.setItem("unrelated", "x");
    const list = store.sessions();
    expect(list.map((x) => [x.id, x.hosting])).toEqual([["GUES2345", false], ["HOST2345", true]]);
    expect(list[1]).toMatchObject({ name: "Mine", ticketCount: 0, estimatedCount: 0, lastActivityAt: 1_000 });
    store.forget("HOST2345");
    store.forget("GUES2345");
    expect(store.sessions()).toEqual([]);
    expect(store.getToken("HOST2345")).toBeUndefined();
  });

  it("keeps a secret host key per hosted room (created once, then stable)", () => {
    const store = new LocalStore(new MemoryStorage());
    const key = store.hostKey("ROOM2345");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(store.hostKey("ROOM2345")).toBe(key);
    expect(store.hostKey("OTHR2345")).not.toBe(key);
    store.forget("ROOM2345");
    expect(store.hostKey("ROOM2345")).not.toBe(key);
  });

  it("survives corrupt entries and unavailable storage", () => {
    const s = new MemoryStorage();
    s.setItem("poker:host:BAD23456", "{not json");
    expect(new LocalStore(s).sessions()).toEqual([]);
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() {}, key: () => null, length: 0, clear() {} } as Storage;
    const store = new LocalStore(broken);
    expect(store.sessions()).toEqual([]);
    expect(() => store.setToken("X", "y")).not.toThrow();
  });
});
