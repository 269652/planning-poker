/** Events the UI sends to the living background. Kept free of three.js so the UI can import it cheaply. */
export type SceneEvent =
  | { kind: "pulse"; x: number; y: number; strength: number; hue?: number }
  | { kind: "reveal"; agreed: boolean; spread: number }
  | { kind: "new-round" }
  | { kind: "settle" }
  | { kind: "shimmer" }
  | { kind: "sparkle" }
  | { kind: "hand"; participantId: string }
  | { kind: "next-scene" };

const listeners = new Set<(e: SceneEvent) => void>();

export function emitScene(e: SceneEvent): void {
  for (const l of listeners) l(e);
}

export function onScene(fn: (e: SceneEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A pulse from the centre of a UI element (e.g. the card that was clicked). */
export function pulseFrom(el: Element | null, strength: number, hue?: number): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  emitScene({ kind: "pulse", x: r.left + r.width / 2, y: r.top + r.height / 2, strength, hue });
}
