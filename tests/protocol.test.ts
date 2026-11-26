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
    for (const type of ["reveal", "nextRound", "ping"] as const) expect(p({ type })).toEqual({ type });
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

  it("validates setRule", () => {
    expect(p({ type: "setRule", rule: "adjacent" })).toEqual({ type: "setRule", rule: "adjacent" });
    expect(() => p({ type: "setRule", rule: "majority" })).toThrow(ProtocolError);
  });

  it("rejects oversize messages", () => {
    expect(() => parseClientMessage(JSON.stringify({ type: "addTicket", title: "x".repeat(70_000) }))).toThrow(ProtocolError);
  });
});
