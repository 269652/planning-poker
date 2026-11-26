import { describe, it, expect } from "vitest";
import { cardLabel, trendLabel, joinUrlFor, writebackLabel, wsUrlFor } from "@/ui/format";

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

  it("builds shareable room links and websocket urls", () => {
    expect(joinUrlFor("https://poker.example", "ABCD2345")).toBe("https://poker.example/room/ABCD2345");
    expect(wsUrlFor({ protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/ws");
    expect(wsUrlFor({ protocol: "https:", host: "p.example" })).toBe("wss://p.example/ws");
  });
});
