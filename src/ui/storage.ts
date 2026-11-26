import { Room, type RoomBoard, type RoomState } from "@/core/room";

/** What the start page lists: rooms this browser hosts, and rooms it joined as a guest. */
export interface SessionEntry {
  id: string;
  name: string;
  board: RoomBoard | null;
  hosting: boolean;
  ticketCount: number;
  estimatedCount: number;
  lastActivityAt: number;
}

export interface JoinedRoom {
  id: string; name: string; board: RoomBoard | null; seenAt: number; ticketCount: number; estimatedCount: number;
}

const HOST = "poker:host:";
const JOINED = "poker:joined:";
const TOKEN = "poker:token:";
const DEMO = "poker:demo:";

/**
 * Browser storage for rooms. A hosted room's full state lives here (the host's browser *is* the
 * server); guests only remember a summary and their reconnect token. Every access tolerates
 * unavailable storage (private mode, blocked site data).
 */
export class LocalStore {
  constructor(private readonly s: Storage | null) {}

  static browser(): LocalStore {
    try { return new LocalStore(window.localStorage); } catch { return new LocalStore(null); }
  }

  private get(k: string): string | null { try { return this.s?.getItem(k) ?? null; } catch { return null; } }
  private set(k: string, v: string): void { try { this.s?.setItem(k, v); } catch { /* full or blocked */ } }
  private del(k: string): void { try { this.s?.removeItem(k); } catch { /* ignore */ } }
  private keys(): string[] {
    const out: string[] = [];
    try { for (let i = 0; i < (this.s?.length ?? 0); i++) { const k = this.s!.key(i); if (k) out.push(k); } } catch { /* ignore */ }
    return out;
  }
  private json<T>(k: string): T | null {
    const raw = this.get(k);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  getToken(roomId: string): string | undefined { return this.get(TOKEN + roomId) ?? undefined; }
  setToken(roomId: string, token: string): void { this.set(TOKEN + roomId, token); }

  isHosting(roomId: string): boolean { return this.get(HOST + roomId) !== null; }
  saveHostedRoom(state: RoomState): void { this.set(HOST + state.id, JSON.stringify(state)); }
  loadHostedRoom(roomId: string): Room | null {
    const s = this.json<RoomState>(HOST + roomId);
    if (!s) return null;
    try {
      // Nobody is connected after a reload.
      s.participants.forEach((p) => (p.connected = false));
      return Room.restore(s);
    } catch { return null; }
  }

  rememberJoined(r: JoinedRoom): void { this.set(JOINED + r.id, JSON.stringify(r)); }

  /** Demo rooms (development only) use fake Jira data instead of the local helper. */
  isDemo(roomId: string): boolean { return this.get(DEMO + roomId) === "1"; }
  setDemo(roomId: string): void { this.set(DEMO + roomId, "1"); }

  getName(): string { return this.get("poker:name") ?? ""; }
  setName(name: string): void { this.set("poker:name", name.trim()); }

  forget(roomId: string): void {
    this.del(HOST + roomId); this.del(JOINED + roomId); this.del(TOKEN + roomId); this.del(DEMO + roomId);
  }

  sessions(): SessionEntry[] {
    const out = new Map<string, SessionEntry>();
    for (const k of this.keys()) {
      if (k.startsWith(JOINED)) {
        const j = this.json<JoinedRoom>(k);
        if (j?.id) out.set(j.id, { id: j.id, name: j.name, board: j.board ?? null, hosting: false, ticketCount: j.ticketCount, estimatedCount: j.estimatedCount, lastActivityAt: j.seenAt });
      }
    }
    for (const k of this.keys()) {
      if (!k.startsWith(HOST)) continue;
      const room = this.loadHostedRoom(k.slice(HOST.length));
      if (!room) continue;
      const token = this.getToken(room.id);
      const sum = room.summary((token && room.authenticate(token)) || "");
      out.set(room.id, { id: room.id, name: sum.name, board: sum.board, hosting: true, ticketCount: sum.ticketCount, estimatedCount: sum.estimatedCount, lastActivityAt: sum.lastActivityAt });
    }
    return [...out.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
}
