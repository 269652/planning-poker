import { describe, it, expect } from "vitest";
import { cardLabel, trendLabel, joinUrlFor, writebackLabel } from "@/ui/format";
import { newRoomId, parseRoomCode } from "@/core/roomId";
import { resolveRelayUrl } from "@/ui/site";

describe("ui format helpers", () => {
  it("labels cards", () => {
    expect(cardLabel(13)).toBe("13");
    expect(cardLabel("?")).toBe("?");
    expect(cardLabel("coffee")).toBe("☕");
    expect(cardLabel(null)).toBe("–");
  });

  it("describes every convergence trend", () => {
    for (const t of ["none", "first", "converging", "diverging", "stalled", "agreed"] as const) {
      const l = trendLabel(t);
      expect(l.text.length).toBeGreaterThan(0);
      expect(["good", "bad", "neutral"]).toContain(l.tone);
    }
    expect(trendLabel("agreed").tone).toBe("good");
    expect(trendLabel("diverging").tone).toBe("bad");
  });

  it("describes write-back states", () => {
    expect(writebackLabel({ status: "none" })).toBeNull();
    expect(writebackLabel({ status: "pending" })).toMatch(/writing/i);
    expect(writebackLabel({ status: "synced" })).toMatch(/jira/i);
    expect(writebackLabel({ status: "failed", error: "boom" })).toContain("boom");
  });

  it("builds shareable room links (static hosting: the code travels in the #fragment)", () => {
    expect(joinUrlFor("https://me.github.io/planning-poker", "ABCD2345")).toBe("https://me.github.io/planning-poker/room/#ABCD2345");
    expect(joinUrlFor("http://localhost:3000/", "ABCD2345")).toBe("http://localhost:3000/room/#ABCD2345");
  });
});

describe("resolveRelayUrl", () => {
  const vercel = { protocol: "https:", host: "planning-poker-psi-five.vercel.app" };
  it("prefers an explicitly configured relay", () => {
    expect(resolveRelayUrl({ configured: "wss://relay.example/api/relay", sameOrigin: true, dev: true, location: vercel })).toBe("wss://relay.example/api/relay");
  });
  it("on Vercel, uses the deployment's own /api/relay (no configuration needed)", () => {
    expect(resolveRelayUrl({ sameOrigin: true, dev: false, location: vercel })).toBe("wss://planning-poker-psi-five.vercel.app/api/relay");
    expect(resolveRelayUrl({ sameOrigin: true, dev: false, location: { protocol: "http:", host: "localhost:3000" } })).toBe("ws://localhost:3000/api/relay");
  });
  it("in development falls back to the local relay; otherwise there is none", () => {
    expect(resolveRelayUrl({ sameOrigin: false, dev: true, location: vercel })).toBe("ws://localhost:8788/api/relay");
    expect(resolveRelayUrl({ sameOrigin: false, dev: false, location: vercel })).toBe("");
  });
});

describe("room codes", () => {
  it("generates 8-character codes without look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(newRoomId()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("reads a code from user input or a pasted invite link", () => {
    expect(parseRoomCode(" abcd2345 ")).toBe("ABCD2345");
    expect(parseRoomCode("https://me.github.io/planning-poker/room/#ABCD2345")).toBe("ABCD2345");
    expect(parseRoomCode("#abcd2345")).toBe("ABCD2345");
    expect(parseRoomCode("ABCD")).toBeNull();
    expect(parseRoomCode("ABCD234O")).toBeNull();
  });
});
