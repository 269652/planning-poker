import { describe, it, expect } from "vitest";
import { parseClientMessage, ProtocolError } from "@/core/protocol";

const p = (o: unknown) => parseClientMessage(JSON.stringify(o));

describe("parseClientMessage", () => {
  it("parses join with defaults and trims", () => {
    expect(p({ type: "join", roomId: "ABC", name: " Al " })).toEqual({ type: "join", roomId: "ABC", name: "Al", role: "voter", token: undefined });
  });

  it("accepts observer role and token", () => {
    expect(p({ type: "join", roomId: "ABC", name: "Al", role: "observer", token: "t" })).toMatchObject({ role: "observer", token: "t" });
  });

  it("rejects bad json, non-objects, unknown types", () => {
    expect(() => parseClientMessage("{nope")).toThrow(ProtocolError);
    expect(() => parseClientMessage("42")).toThrow(ProtocolError);
    expect(() => p({ type: "explode" })).toThrow(ProtocolError);
  });

  it("validates cards on vote", () => {
    expect(p({ type: "vote", card: 13 })).toEqual({ type: "vote", card: 13 });
    expect(p({ type: "vote", card: "coffee" })).toEqual({ type: "vote", card: "coffee" });
    expect(() => p({ type: "vote", card: 4 })).toThrow(ProtocolError);
    expect(() => p({ type: "vote" })).toThrow(ProtocolError);
  });

  it("parses simple host commands", () => {
    for (const type of ["reveal", "nextRound", "nextTicket", "ping"] as const) expect(p({ type })).toEqual({ type });
  });

  it("finalize value is optional but must be numeric card when present", () => {
    expect(p({ type: "finalize" })).toEqual({ type: "finalize", value: undefined });
    expect(p({ type: "finalize", value: 8 })).toEqual({ type: "finalize", value: 8 });
    expect(() => p({ type: "finalize", value: "?" })).toThrow(ProtocolError);
  });

  it("validates ticket commands", () => {
    expect(p({ type: "addTicket", title: " Do it ", description: "d" })).toEqual({ type: "addTicket", title: "Do it", description: "d" });
    expect(() => p({ type: "addTicket", title: "" })).toThrow(ProtocolError);
    expect(p({ type: "selectTicket", ticketId: "x" })).toEqual({ type: "selectTicket", ticketId: "x" });
    expect(() => p({ type: "selectTicket" })).toThrow(ProtocolError);
  });

  it("validates importJira keys (non-empty, bounded, well-formed)", () => {
    expect(p({ type: "importJira", issueKeys: ["A-1", "PROJ-22"] })).toEqual({ type: "importJira", issueKeys: ["A-1", "PROJ-22"] });
    expect(() => p({ type: "importJira", issueKeys: [] })).toThrow(ProtocolError);
    expect(() => p({ type: "importJira", issueKeys: ["not a key"] })).toThrow(ProtocolError);
    expect(() => p({ type: "importJira", issueKeys: Array.from({ length: 201 }, (_, i) => `A-${i + 1}`) })).toThrow(ProtocolError);
  });

  it("validates raiseHand", () => {
    expect(p({ type: "raiseHand", raised: true })).toEqual({ type: "raiseHand", raised: true });
    expect(p({ type: "raiseHand", raised: false })).toEqual({ type: "raiseHand", raised: false });
    expect(() => p({ type: "raiseHand", raised: "yes" })).toThrow(ProtocolError);
  });

  it("validates setRule", () => {
    expect(p({ type: "setRule", rule: "adjacent" })).toEqual({ type: "setRule", rule: "adjacent" });
    expect(() => p({ type: "setRule", rule: "majority" })).toThrow(ProtocolError);
  });

  it("rejects oversize messages", () => {
    expect(() => parseClientMessage(JSON.stringify({ type: "addTicket", title: "x".repeat(70_000) }))).toThrow(ProtocolError);
  });
});

describe("message type registry", () => {
  it("every registered client type is accepted by the parser (no drift)", async () => {
    const { CLIENT_MESSAGE_TYPES } = await import("@/core/protocol");
    const samples: Record<string, unknown> = {
      join: { roomId: "R", name: "n" }, vote: { card: 1 }, reveal: {}, nextRound: {}, nextTicket: {}, finalize: {},
      reopen: { ticketId: "t" }, selectTicket: { ticketId: "t" }, removeTicket: { ticketId: "t" },
      addTicket: { title: "t" }, importJira: { issueKeys: ["A-1"] }, retryWriteback: { ticketId: "t" },
      setRule: { rule: "adjacent" }, raiseHand: { raised: true }, ping: {},
    };
    expect(Object.keys(samples).sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
    for (const type of CLIENT_MESSAGE_TYPES) expect(() => p({ type, ...(samples[type] as object) }), type).not.toThrow();
  });
});
