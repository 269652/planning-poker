import { describe, it, expect, vi } from "vitest";
import { MAX_DESCRIPTION_CHARS, parseClientMessage } from "@/core/protocol";
import { StreamStore } from "@/ui/streamStore";

const list = { title: "T", query: "login", issues: [{ key: "BMG-1", summary: "S", issueType: "Story", status: "To Do", estimate: 3, inSession: false }], picked: [] };

describe("StreamStore (what viewers see)", () => {
  it("keeps the list, tells presenter and viewer cursors apart, and ends only for the current streamer", () => {
    const s = new StreamStore();
    const changed = vi.fn(), moved = vi.fn(), ended = vi.fn();
    s.subscribe(changed); s.onPointer(moved); s.onEnd(ended);
    expect(s.receive({ type: "pong" })).toBe(false);
    s.receive({ type: "stream", from: "p", name: "Paula", kind: "list", list });
    expect(s.get()).toMatchObject({ name: "Paula", list: { title: "T" } });
    s.receive({ type: "stream", from: "x", name: "Xavi", kind: "pointer", pointer: { x: 1, y: 1, scroll: 1 } });
    expect(moved).toHaveBeenLastCalledWith({ x: 1, y: 1, scroll: 1 }, { from: "x", name: "Xavi", presenter: false });
    expect(s.pointer()).toBeNull(); // a viewer's cursor never drives the scroll
    s.receive({ type: "stream", from: "p", name: "Paula", kind: "pointer", pointer: { x: 0.2, y: 0.3, scroll: 0 } });
    expect(moved).toHaveBeenLastCalledWith({ x: 0.2, y: 0.3, scroll: 0 }, { from: "p", name: "Paula", presenter: true });
    expect(s.pointer()).toEqual({ x: 0.2, y: 0.3, scroll: 0 });
    s.receive({ type: "stream", from: "x", name: "X", kind: "end" });
    expect(s.get()).not.toBeNull();
    s.receive({ type: "stream", from: "p", name: "Paula", kind: "end" });
    expect(s.get()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(ended).toHaveBeenLastCalledWith("p");
  });

  it("the presenter (no list of their own) still gets the viewers' cursors", () => {
    const s = new StreamStore();
    const moved = vi.fn();
    s.onPointer(moved);
    s.receive({ type: "stream", from: "b", name: "Bob", kind: "pointer", pointer: { x: 0.5, y: 0.5, scroll: 0, row: "BMG-1", rx: 0.1, ry: 0.9 } });
    expect(moved).toHaveBeenCalledWith(expect.objectContaining({ row: "BMG-1" }), { from: "b", name: "Bob", presenter: false });
  });
});

describe("stream protocol", () => {
  const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
  it("validates lists and clamps pointers", () => {
    expect(p({ type: "stream", kind: "pointer", pointer: { x: -1, y: 0.5, scroll: "x" } })).toEqual({ type: "stream", kind: "pointer", pointer: { x: 0, y: 0.5, scroll: 0 } });
    expect(p({ type: "stream", kind: "list", list: { ...list, picked: ["BMG-1", 42] } })).toMatchObject({ list: { picked: ["BMG-1"], query: "login" } });
    expect(p({ type: "stream", kind: "list", list: { ...list, query: undefined } })).toMatchObject({ list: { query: "" } }); // older clients
    expect(() => p({ type: "stream", kind: "list", list: { ...list, issues: [{ key: "<script>" }] } })).toThrow();
    expect(() => p({ type: "stream", kind: "list", list: { ...list, issues: Array.from({ length: 301 }, () => list.issues[0]) } })).toThrow();
    expect(() => p({ type: "stream", kind: "dance" })).toThrow();
  });

  it("carries the opened row with its description (shortened)", () => {
    const long = "x".repeat(MAX_DESCRIPTION_CHARS + 50);
    expect(p({ type: "stream", kind: "list", list: { ...list, expanded: { key: "BMG-1", text: long } } }))
      .toMatchObject({ list: { expanded: { key: "BMG-1", text: "x".repeat(MAX_DESCRIPTION_CHARS) } } });
    expect(p({ type: "stream", kind: "list", list: { ...list, expanded: { key: "<b>", text: "t" } } })).not.toHaveProperty("list.expanded");
  });

  it("anchors cursor and scroll to rows (any screen size, any scroll offset)", () => {
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0.3, row: "BMG-7", rx: 0.25, ry: 1.4, topRow: "BMG-3", topOff: 0.5 } }))
      .toEqual({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0.3, row: "BMG-7", rx: 0.25, ry: 1, topRow: "BMG-3", topOff: 0.5 } });
    // Over an opened description: anchored to a block of its text, and the description's own scroll.
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0, y: 0, scroll: 0, row: "BMG-7", detail: true, block: 3, rx: 0.2, ry: 0.6, detailScroll: 0.4 } }))
      .toMatchObject({ pointer: { row: "BMG-7", detail: true, block: 3, rx: 0.2, ry: 0.6, detailScroll: 0.4 } });
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0, y: 0, scroll: 0, row: "BMG-7", block: 3 } }).type).toBe("stream"); // block only with detail
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0, y: 0, scroll: 0, row: "BMG-7", block: 3 } })).not.toHaveProperty("pointer.block");
    // Over a named part of the dialog (header, filters, search, footer): anchored to it.
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0, anchor: "search", rx: 0.4, ry: 0.5 } }))
      .toEqual({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0, anchor: "search", rx: 0.4, ry: 0.5 } });
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0, y: 0, scroll: 0, anchor: "body" } }).type).toBe("stream"); // unknown part dropped
    // Not a ticket key: no row anchor (falls back to the dialog position).
    expect(p({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0, row: "\"]<x>", topRow: 5 } }))
      .toEqual({ type: "stream", kind: "pointer", pointer: { x: 0.1, y: 0.2, scroll: 0 } });
  });
});
