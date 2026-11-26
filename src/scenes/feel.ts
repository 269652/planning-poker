/** A UI element as the organism perceives it. */
export interface FeltElement {
  rect: { left: number; top: number; width: number; height: number };
  radius: number;
  hovered?: boolean;
  focused?: boolean;
}

/** The element in simulation pixels (y down, like the DOM). `interest` scales the scent at its edges. */
export interface SimRect { x: number; y: number; w: number; h: number; radius: number; interest: number }

/** Maps visible UI elements into the simulation grid; hovered/focused elements smell stronger. */
export function feelRects(
  elements: FeltElement[],
  viewport: { width: number; height: number },
  sim: { width: number; height: number },
): SimRect[] {
  const sx = sim.width / viewport.width;
  const sy = sim.height / viewport.height;
  const out: SimRect[] = [];
  for (const e of elements) {
    const { left, top, width, height } = e.rect;
    if (width <= 0 || height <= 0) continue;
    const x0 = Math.max(0, left), y0 = Math.max(0, top);
    const x1 = Math.min(viewport.width, left + width), y1 = Math.min(viewport.height, top + height);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({
      x: x0 * sx, y: y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy,
      radius: e.radius * sx,
      interest: 1 + (e.hovered ? 1 : 0) + (e.focused ? 2 : 0),
    });
  }
  return out;
}
