import type { BoardSpot, ServerMessage } from "@/core/protocol";

/** Everyone's mouse in the room, as it arrives (many times a second): plain listeners, no React state. */
export class PresenceStore {
  private readonly listeners = new Set<(from: string, name: string, spot: BoardSpot | null) => void>();

  /** Feed server messages in; returns true when it was a cursor message. */
  receive(m: ServerMessage): boolean {
    if (m.type !== "cursor") return false;
    for (const l of this.listeners) l(m.from, m.name, m.spot);
    return true;
  }

  on(fn: (from: string, name: string, spot: BoardSpot | null) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

/**
 * Where the mouse is in the room UI: its spot in the window (0..1 of width and height), shown to the
 * others at the same spot of *their* window (vw/vh). Over the card pane only "in the cards" — never
 * where. Inside a dialog: nothing (the import stream shows its own cursors).
 */
export function locateBoard(clientX: number, clientY: number): BoardSpot | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el || el.closest(".modal-backdrop")) return null;
  if (el.closest('[data-cursor-private="cards"]')) return { x: 0, y: 0, cards: true };
  return { x: clientX / Math.max(1, window.innerWidth), y: clientY / Math.max(1, window.innerHeight) };
}

/** A stable colour per person (from their id). */
export function personHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

const CURSOR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z"/></svg>';

/**
 * The others' cursors in the room, at the same spot of the window (vw/vh, fixed). Over the card pane
 * a cursor becomes just a name tag in that pane's header. Elements are made by hand, so React never
 * trips over them.
 */
export class BoardCursors {
  private readonly cursors = new Map<string, { el: HTMLDivElement; seen: number; leaving?: ReturnType<typeof setTimeout> }>();

  place(id: string, name: string, spot: BoardSpot | null): void {
    const known = this.cursors.get(id);
    if (!spot) {
      // Left the window: fade out instead of vanishing (and stay if they come right back).
      if (known) {
        known.el.classList.add("leaving");
        clearTimeout(known.leaving);
        known.leaving = setTimeout(() => this.remove(id), 1500);
      }
      return;
    }
    let c = known;
    if (c) { clearTimeout(c.leaving); c.el.classList.remove("leaving"); }
    else {
      const el = document.createElement("div");
      el.className = "board-cursor";
      el.setAttribute("aria-hidden", "true");
      el.style.setProperty("--c", `hsl(${personHue(id)} 70% 50%)`);
      el.innerHTML = `${CURSOR_SVG}<span></span>`;
      c = { el, seen: 0 };
      this.cursors.set(id, c);
    }
    c.seen = Date.now();
    const el = c.el;
    el.querySelector("span")!.textContent = name;

    if (spot.cards) {
      // In the card pane: a name tag there, no position.
      const slot = document.querySelector<HTMLElement>('[data-cursor-slot="cards"]');
      if (!slot) { el.remove(); return; }
      el.classList.add("in-pane");
      el.style.left = ""; el.style.top = "";
      if (el.parentElement !== slot) slot.appendChild(el);
      return;
    }
    const left = `${spot.x * 100}vw`, top = `${spot.y * 100}vh`;
    if (el.parentElement !== document.body || el.classList.contains("in-pane")) {
      // Arriving from elsewhere: set the spot first, so it doesn't glide in.
      el.classList.remove("in-pane");
      el.classList.add("jump");
      el.style.left = left; el.style.top = top;
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.remove("jump");
    } else {
      el.style.left = left; el.style.top = top;
    }
  }

  /** Only people still in the room keep a cursor; idle ones go after a while. */
  retain(ids: Set<string>, maxIdleMs: number): void {
    const now = Date.now();
    for (const [id, c] of this.cursors) if (!ids.has(id) || now - c.seen > maxIdleMs) this.remove(id);
  }

  remove(id: string): void {
    const c = this.cursors.get(id);
    if (c) { clearTimeout(c.leaving); c.el.remove(); }
    this.cursors.delete(id);
  }
  clear(): void { for (const id of [...this.cursors.keys()]) this.remove(id); }
}
