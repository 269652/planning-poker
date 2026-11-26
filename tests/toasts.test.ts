import { describe, it, expect } from "vitest";
import type { RoomView, TicketView } from "@/core/room";
import { writebackToasts } from "@/ui/toasts";

const ticket = (over: Partial<TicketView>): TicketView => ({
  id: "t1", key: "BMG-1", title: "Login", source: "jira", currentEstimate: null, status: "estimated",
  estimate: 5, resolution: "agreement", rounds: [], writeback: { status: "pending" },
  convergence: { trend: "none", score: null, history: [] } as unknown as TicketView["convergence"], ...over,
});
const view = (tickets: TicketView[]): RoomView => ({
  id: "R", name: "R", rule: "unanimous", you: "p", hostId: "p", currentTicketId: null, board: null, participants: [], tickets,
});

describe("writebackToasts", () => {
  it("announces a successful write-back with the key and points", () => {
    const out = writebackToasts(view([ticket({})]), view([ticket({ writeback: { status: "synced" } })]));
    expect(out).toEqual([{ id: "t1:synced", tone: "good", message: "BMG-1: 5 points written to Jira" }]);
  });

  it("announces a failed write-back with the error", () => {
    const out = writebackToasts(view([ticket({})]), view([ticket({ writeback: { status: "failed", error: "403 Forbidden" } })]));
    expect(out).toEqual([{ id: "t1:failed", tone: "bad", message: "BMG-1: Jira write-back failed — 403 Forbidden" }]);
  });

  it("announces success after a retry of a failed write-back", () => {
    const out = writebackToasts(view([ticket({ writeback: { status: "failed", error: "x" } })]), view([ticket({ writeback: { status: "synced" } })]));
    expect(out.map((t) => t.tone)).toEqual(["good"]);
  });

  it("stays quiet on the first state (joining a room must not replay old results)", () => {
    expect(writebackToasts(null, view([ticket({ writeback: { status: "synced" } })]))).toEqual([]);
  });

  it("stays quiet when nothing changed or a ticket is new", () => {
    const synced = ticket({ writeback: { status: "synced" } });
    expect(writebackToasts(view([synced]), view([synced]))).toEqual([]);
    expect(writebackToasts(view([]), view([synced]))).toEqual([]);
  });
});
