import type { ServerMessage, StreamList, StreamPointer } from "@/core/protocol";

export interface StreamSnapshot { from: string; name: string; list: StreamList }
/** Whose cursor moved: the presenter's (drives the scroll too) or a viewer's (shown faded). */
export interface PointerFrom { from: string; name: string; presenter: boolean }

/**
 * What a host/PM is currently streaming from the import dialog, for everyone in the room. The list
 * changes rarely (React re-renders on it); cursors — the presenter's and every viewer's — arrive many
 * times a second and go to plain listeners that move ghost cursors directly, without re-rendering.
 * The presenter has no snapshot (their own list isn't echoed) but still gets the viewers' cursors.
 */
export class StreamStore {
  private snapshot: StreamSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly pointerListeners = new Set<(p: StreamPointer, who: PointerFrom) => void>();
  private readonly endListeners = new Set<(from: string) => void>();
  private lastPointer: StreamPointer | null = null;

  /** Feed server messages in; returns true when it was a stream message. */
  receive(m: ServerMessage): boolean {
    if (m.type !== "stream") return false;
    if (m.kind === "list") {
      this.snapshot = { from: m.from, name: m.name, list: m.list };
      this.emit();
    } else if (m.kind === "end") {
      if (this.snapshot?.from === m.from) { this.snapshot = null; this.lastPointer = null; this.emit(); }
      for (const l of this.endListeners) l(m.from);
    } else {
      const presenter = this.snapshot?.from === m.from;
      if (presenter) this.lastPointer = m.pointer;
      for (const l of this.pointerListeners) l(m.pointer, { from: m.from, name: m.name, presenter });
    }
    return true;
  }

  clear(): void { this.snapshot = null; this.lastPointer = null; this.emit(); }

  get = (): StreamSnapshot | null => this.snapshot;
  /** The presenter's last cursor/scroll. */
  pointer = (): StreamPointer | null => this.lastPointer;

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  onPointer(fn: (p: StreamPointer, who: PointerFrom) => void): () => void { this.pointerListeners.add(fn); return () => { this.pointerListeners.delete(fn); }; }
  /** A stream ended (its presenter's id). */
  onEnd(fn: (from: string) => void): () => void { this.endListeners.add(fn); return () => { this.endListeners.delete(fn); }; }

  private emit() { for (const l of this.listeners) l(); }
}
