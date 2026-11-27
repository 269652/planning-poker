import { describe, it, expect, vi } from "vitest";
import { backgroundEnabled, setBackgroundEnabled, BACKGROUND_EVENT } from "@/ui/preferences";

const memory = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
  };
};

describe("animated background preference", () => {
  it("is off by default", () => {
    expect(backgroundEnabled(memory())).toBe(false);
    expect(backgroundEnabled(null)).toBe(false);
  });

  it("remembers the choice and announces changes", () => {
    const s = memory();
    const target = new EventTarget();
    const heard = vi.fn();
    target.addEventListener(BACKGROUND_EVENT, (e) => heard((e as CustomEvent<boolean>).detail));
    setBackgroundEnabled(false, s, target);
    expect(backgroundEnabled(s)).toBe(false);
    setBackgroundEnabled(true, s, target);
    expect(backgroundEnabled(s)).toBe(true);
    expect(heard.mock.calls).toEqual([[false], [true]]);
  });

  it("survives unavailable storage", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } as unknown as Storage;
    expect(backgroundEnabled(broken)).toBe(false);
    expect(() => setBackgroundEnabled(false, broken, new EventTarget())).not.toThrow();
  });
});
