import type { StreamAnchor, StreamPointer } from "@/core/protocol";

/** The blocks of a rendered description a cursor anchors to (document order, same on every screen). */
const DETAIL_BLOCKS = "p, li, h4, pre, blockquote, td, th";

/** A pointer without the presenter-only scroll fields. */
export type Spot = Omit<StreamPointer, "scroll" | "topRow" | "topOff" | "detailScroll">;

/**
 * Where (clientX, clientY) is inside `root`, relative to what's under it: an opened description's
 * text (`[data-detail]`, measured over the *whole* text, so its own scroll offset is included), a
 * ticket row (`[data-key]`) or a named part (`[data-anchor]`). That spot exists on every screen, at
 * any zoom and scroll offset.
 */
export function locate(root: HTMLElement, clientX: number, clientY: number): Spot {
  const r = root.getBoundingClientRect();
  const under = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-detail], [data-key], [data-anchor]");
  const inside = under && root.contains(under) ? under : null;
  const spot: Spot = { x: (clientX - r.left) / Math.max(1, r.width), y: (clientY - r.top) / Math.max(1, r.height) };
  if (!inside) return spot;
  const relTo = (el: HTMLElement) => {
    const ur = el.getBoundingClientRect();
    return { rx: (clientX - ur.left) / Math.max(1, ur.width), ry: (clientY - ur.top) / Math.max(1, ur.height) };
  };
  if (inside.dataset.detail) {
    // In a description: anchor to the block (paragraph, item, …) under the cursor — the same block
    // exists on every screen even where the text wraps differently. Else the whole text box
    // (scrolled-away part included).
    const blocks = [...inside.querySelectorAll<HTMLElement>(DETAIL_BLOCKS)];
    const hit = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(DETAIL_BLOCKS);
    const block = hit && inside.contains(hit) ? blocks.indexOf(hit) : -1;
    if (block >= 0) return { ...spot, row: inside.dataset.detail, detail: true, block, ...relTo(blocks[block]) };
    return { ...spot, row: inside.dataset.detail, detail: true, ...relTo(inside) };
  }
  const rel = relTo(inside);
  if (inside.dataset.key) return { ...spot, row: inside.dataset.key, ...rel };
  return { ...spot, anchor: inside.dataset.anchor as StreamAnchor, ...rel };
}

/** How far the opened description (`.row-detail`) in `root` is scrolled (0..1), if one is open. */
export function detailScroll(root: HTMLElement | null): number | undefined {
  const d = root?.querySelector<HTMLElement>(".row-detail");
  if (!d) return undefined;
  const max = d.scrollHeight - d.clientHeight;
  return max > 0 ? d.scrollTop / max : 0;
}

const CURSOR_SVG = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z"/></svg>';

/**
 * Ghost cursors inside a dialog. Each ghost is placed *into* the row (or part) it points at, in % of
 * that element, so the browser keeps it there while scrolling, zooming and reflowing — no lag. The
 * elements are made by hand, not by React, so React never trips over them.
 */
export class GhostLayer {
  private readonly ghosts = new Map<string, { el: HTMLDivElement; seen: number; spot: Spot }>();

  constructor(private readonly root: () => HTMLElement | null) {}

  place(id: string, name: string, spot: Spot, faded: boolean): void {
    const root = this.root();
    if (!root) return;
    let g = this.ghosts.get(id);
    if (!g) {
      const el = document.createElement("div");
      el.className = "ghost-cursor";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = `${CURSOR_SVG}<span></span>`;
      g = { el, seen: 0, spot };
      this.ghosts.set(id, g);
    }
    g.seen = Date.now();
    g.spot = spot;
    g.el.classList.toggle("faded", faded);
    g.el.querySelector("span")!.textContent = name;
    const key = spot.row ? CSS.escape(spot.row) : null;
    // Over a description: inside the same block of its text (or the text box), which scrolls natively
    // with the text; else the row, else the named part.
    const text = key && spot.detail ? root.querySelector<HTMLElement>(`[data-detail="${key}"]`) : null;
    const block = text && spot.block !== undefined ? text.querySelectorAll<HTMLElement>(DETAIL_BLOCKS)[spot.block] ?? null : null;
    const target = block || text
      || (key && root.querySelector<HTMLElement>(`li[data-key="${key}"]`))
      || (spot.anchor && root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(spot.anchor)}"]`)) || null;
    const host = target ?? root;
    const x = target ? (spot.rx ?? 0.5) : spot.x, y = target ? (spot.ry ?? 0.5) : spot.y;
    if (g.el.parentElement !== host) {
      // Into another element: set the spot first, so it doesn't glide in from elsewhere.
      g.el.classList.add("jump");
      g.el.style.left = `${x * 100}%`; g.el.style.top = `${y * 100}%`;
      host.appendChild(g.el);
      void g.el.offsetWidth;
      g.el.classList.remove("jump");
    } else {
      g.el.style.left = `${x * 100}%`; g.el.style.top = `${y * 100}%`;
    }
  }

  /** Put every ghost back into its row (after the list re-rendered). */
  refresh(): void {
    for (const [id, g] of this.ghosts) this.place(id, g.el.querySelector("span")?.textContent ?? "", g.spot, g.el.classList.contains("faded"));
  }

  /** Ghosts not moved for a while (that person stopped looking) fade out. */
  prune(maxAgeMs: number): void {
    const now = Date.now();
    for (const [id, g] of this.ghosts) if (now - g.seen > maxAgeMs) { g.el.remove(); this.ghosts.delete(id); }
  }

  remove(id: string): void { this.ghosts.get(id)?.el.remove(); this.ghosts.delete(id); }
  clear(): void { for (const g of this.ghosts.values()) g.el.remove(); this.ghosts.clear(); }
}

/** Calls `send` at most every `ms` milliseconds, always delivering the latest value. */
export function throttle<T>(ms: number, send: (v: T) => void): (v: T) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: T;
  return (v: T) => {
    latest = v;
    clearTimeout(timer);
    const wait = ms - (performance.now() - last);
    const fire = () => { last = performance.now(); send(latest); };
    if (wait <= 0) fire(); else timer = setTimeout(fire, wait);
  };
}
