import { describe, it, expect, vi } from "vitest";
import type { RoomView, TicketView, RoundView } from "@/core/room";
import { organismParams, smoothstep, drift, PARAM_RANGES } from "@/scenes/moods";
import { feelRects, type FeltElement } from "@/scenes/feel";
import { Interaction } from "@/scenes/interaction";
import { emitScene, onScene } from "@/scenes/bus";
import { sceneEventsFor } from "@/scenes/events";
import { cardPattern } from "@/ui/cardPattern";

describe("organism moods", () => {
  const calm = { harmony: 0, turbulence: 0, energy: 0 };

  it("parameters always stay within their safe ranges", () => {
    for (let t = 0; t < 3600; t += 7.3) {
      for (const mood of [calm, { harmony: 1, turbulence: 0, energy: 1.5 }, { harmony: 0, turbulence: 1, energy: 1 }]) {
        const p = organismParams(t, mood);
        for (const [k, [lo, hi]] of Object.entries(PARAM_RANGES)) {
          const v = p[k as keyof typeof p];
          expect(v, `${k} at t=${t}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${k} at t=${t}`).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it("drifts over time on its own (changing behaviour)", () => {
    const a = organismParams(0, calm), b = organismParams(240, calm);
    expect(a.sensorAngle).not.toBeCloseTo(b.sensorAngle, 2);
  });

  it("breathes gently within seconds, without shaking the foam apart", () => {
    const samples = Array.from({ length: 16 }, (_, i) => organismParams(100 + i, calm).sensorDist);
    const range = Math.max(...samples) - Math.min(...samples);
    expect(range).toBeGreaterThan(0.8);
    expect(range).toBeLessThan(4);
  });

  it("agreement calms it into long flowing veins; a split vote makes it restless", () => {
    const base = organismParams(100, calm);
    const harmonious = organismParams(100, { ...calm, harmony: 1 });
    const turbulent = organismParams(100, { ...calm, turbulence: 1 });
    expect(harmonious.wander).toBeLessThan(base.wander);
    expect(harmonious.decay).toBeGreaterThan(base.decay);
    expect(turbulent.wander).toBeGreaterThan(base.wander);
    expect(turbulent.turn).toBeGreaterThan(base.turn);
  });

  it("agreement only nudges it: the tissue never freezes (trails keep fading, threads keep wandering)", () => {
    for (let t = 0; t < 600; t += 7) {
      const p = organismParams(t, { harmony: 1, turbulence: 0, energy: 0 });
      expect(p.decay).toBeLessThanOrEqual(0.955);
      expect(p.wander).toBeGreaterThan(0.02);
      expect(p.sensorDist).toBeLessThanOrEqual(19);
    }
  });

  it("activity makes it move faster", () => {
    expect(organismParams(50, { ...calm, energy: 1 }).speed).toBeGreaterThan(organismParams(50, calm).speed);
  });

  it("helpers: smoothstep clamps and eases; drift stays in [-1, 1]", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    for (let t = 0; t < 500; t += 3.1) expect(Math.abs(drift(t, 2))).toBeLessThanOrEqual(1);
  });
});

describe("feelRects (the organism feels UI elements as bodies with edges)", () => {
  const el = (x: number, y: number, w: number, h: number, extra: Partial<FeltElement> = {}): FeltElement =>
    ({ rect: { left: x, top: y, width: w, height: h }, radius: 12, ...extra });

  it("maps viewport rectangles into simulation pixels", () => {
    const [r] = feelRects([el(100, 50, 200, 100)], { width: 1000, height: 500 }, { width: 500, height: 250 });
    expect(r).toEqual({ x: 50, y: 25, w: 100, h: 50, radius: 6, interest: 1 });
  });

  it("drops invisible and off-screen elements and clips partly visible ones", () => {
    const out = feelRects([el(0, 0, 0, 10), el(-500, 0, 100, 100), el(950, 480, 200, 200)], { width: 1000, height: 500 }, { width: 1000, height: 500 });
    expect(out).toEqual([{ x: 950, y: 480, w: 50, h: 20, radius: 12, interest: 1 }]);
  });

  it("hovered and focused elements are more interesting (stronger scent)", () => {
    const out = feelRects([el(0, 0, 10, 10, { hovered: true }), el(20, 0, 10, 10, { focused: true }), el(40, 0, 10, 10, { hovered: true, focused: true })],
      { width: 100, height: 100 }, { width: 100, height: 100 });
    expect(out.map((r) => r.interest)).toEqual([2, 3, 4]);
  });
});

describe("cardPattern (procedural card backs)", () => {
  it("is deterministic for an id and differs between ids", () => {
    const a = cardPattern("0b1e6f1c-1111-4a2b-9c3d-000000000001");
    expect(cardPattern("0b1e6f1c-1111-4a2b-9c3d-000000000001")).toEqual(a);
    const others = new Set(Array.from({ length: 30 }, (_, i) => cardPattern(`id-${i}`).backgroundImage));
    expect(others.size).toBe(30);
  });

  it("produces a CSS background with an inline SVG and an accent colour", () => {
    const p = cardPattern("x");
    expect(p.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(p.accent).toMatch(/^hsl\(/);
    expect(decodeURIComponent(p.backgroundImage)).toContain("<svg");
  });
});

describe("Interaction (shared state the organism reacts to)", () => {
  it("tracks the pointer in normalized device coordinates and its speed", () => {
    const s = new Interaction();
    s.resize(200, 100);
    s.pointerAt(200, 0, 0);
    expect(s.pointer).toEqual({ x: 1, y: 1 });
    s.pointerAt(100, 50, 0.1);
    expect(s.pointer).toEqual({ x: 0, y: 0 });
    expect(s.pointerSpeed).toBeGreaterThan(0);
  });

  it("pulses age, expire and raise energy; at most 8 stay active", () => {
    const s = new Interaction();
    s.resize(100, 100);
    for (let i = 0; i < 12; i++) s.pulse(50, 50, 0.5, 0.3);
    expect(s.pulses).toHaveLength(8);
    expect(s.energy).toBeGreaterThan(0.5);
    s.update(10);
    expect(s.pulses).toHaveLength(0);
    expect(s.energy).toBeLessThan(0.05);
  });

  it("calm mode (reduced motion) keeps reacting, with softer pulses", () => {
    const calm = new Interaction(0.5);
    calm.resize(100, 100);
    calm.pulse(50, 50, 1, 0);
    expect(calm.pulses[0].strength).toBe(0.5);
  });

  it("harmony and turbulence ease toward their targets", () => {
    const s = new Interaction();
    s.setMood({ harmony: 1, turbulence: 0 });
    for (let i = 0; i < 200; i++) s.update(0.05);
    expect(s.harmony).toBeGreaterThan(0.95);
    s.setMood({ harmony: 0, turbulence: 1 });
    for (let i = 0; i < 200; i++) s.update(0.05);
    expect(s.turbulence).toBeGreaterThan(0.95);
  });

  it("shimmer and sparkle are short-lived flashes", () => {
    const s = new Interaction();
    s.flash("shimmer");
    s.flash("sparkle");
    expect(s.shimmer).toBe(1);
    expect(s.sparkle).toBe(1);
    s.update(5);
    expect(s.shimmer).toBeLessThan(0.05);
    expect(s.sparkle).toBeLessThan(0.05);
  });
});

describe("scene event bus", () => {
  it("delivers events to subscribers until they unsubscribe", () => {
    const fn = vi.fn();
    const off = onScene(fn);
    emitScene({ kind: "sparkle" });
    off();
    emitScene({ kind: "sparkle" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

const round = (over: Partial<RoundView>): RoundView => ({
  number: 1, status: "voting", voted: [], votes: null, myVote: null, stats: null, rule: null, startedAt: 0, revealedAt: null, patterns: {}, ...over,
});
const ticket = (over: Partial<TicketView>): TicketView => ({
  id: "t1", title: "T", source: "jira", key: "K-1", currentEstimate: null, status: "open", estimate: null, resolution: null,
  rounds: [round({})], writeback: { status: "none" }, convergence: {} as TicketView["convergence"], ...over,
});
const person = (id: string, over: Partial<RoomView["participants"][number]> = {}) =>
  ({ id, name: id.toUpperCase(), role: "voter" as const, connected: true, isHost: id === "a", hasVoted: false, handRaised: false, ...over });
const view = (over: Partial<RoomView>): RoomView => ({
  id: "R", name: "R", board: null, rule: "unanimous", you: "a", hostId: "a", currentTicketId: "t1",
  participants: [person("a")], tickets: [ticket({})], chat: [], ...over,
});
const stats = (agreed: boolean, spreadSteps: number) => ({ agreed, spreadSteps } as unknown as RoundView["stats"]);

describe("sceneEventsFor (room changes become the organism's moods)", () => {
  it("nothing on the first state", () => {
    expect(sceneEventsFor(null, view({}))).toEqual([]);
  });

  it("a reveal with agreement brings harmony; a wide spread brings turbulence", () => {
    const agreed = view({ tickets: [ticket({ rounds: [round({ status: "revealed", stats: stats(true, 0) })] })] });
    expect(sceneEventsFor(view({}), agreed)).toEqual([{ kind: "reveal", agreed: true, spread: 0 }]);
    const split = view({ tickets: [ticket({ rounds: [round({ status: "revealed", stats: stats(false, 6) })] })] });
    expect(sceneEventsFor(view({}), split)).toEqual([{ kind: "reveal", agreed: false, spread: 6 }]);
  });

  it("a new round calms back to neutral; an accepted estimate settles; a synced write-back shimmers", () => {
    const revealed = view({ tickets: [ticket({ rounds: [round({ status: "revealed", stats: stats(false, 3) })] })] });
    const next = view({ tickets: [ticket({ rounds: [round({ status: "revealed", stats: stats(false, 3) }), round({ number: 2 })] })] });
    expect(sceneEventsFor(revealed, next)).toEqual([{ kind: "new-round" }]);
    const est = view({ tickets: [ticket({ status: "estimated", estimate: 5, writeback: { status: "pending" } })] });
    expect(sceneEventsFor(view({}), est)).toEqual([{ kind: "settle" }]);
    const synced = view({ tickets: [ticket({ status: "estimated", estimate: 5, writeback: { status: "synced" } })] });
    expect(sceneEventsFor(est, synced)).toEqual([{ kind: "shimmer" }]);
  });

  it("someone joining sparkles; moving to another ticket is a new chapter", () => {
    const joined = view({ participants: [person("a"), person("b")] });
    expect(sceneEventsFor(view({}), joined)).toEqual([{ kind: "sparkle" }]);
    const other = view({ currentTicketId: "t2", tickets: [ticket({}), ticket({ id: "t2" })] });
    expect(sceneEventsFor(view({ tickets: [ticket({}), ticket({ id: "t2" })] }), other)).toEqual([{ kind: "next-scene" }]);
  });

  it("a raised hand makes the organism reach for that person", () => {
    const before = view({ participants: [person("a"), person("b")] });
    const raised = view({ participants: [person("a"), person("b", { handRaised: true })] });
    expect(sceneEventsFor(before, raised)).toEqual([{ kind: "hand", participantId: "b" }]);
    expect(sceneEventsFor(raised, before)).toEqual([]);
  });
});
