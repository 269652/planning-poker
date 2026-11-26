import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Room, type RoomState } from "@/core/room";
import type { AgreementRule } from "@/core/stats";

// No 0/O/1/I/L: room ids are read aloud and typed by humans.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_ID = /^[A-Z2-9]{8}$/;

export function newRoomId(): string {
  let id = "";
  for (let i = 0; i < 8; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

export interface RegistryOptions {
  dataDir?: string;
  persistDelayMs?: number;
}

/** In-memory rooms with optional debounced JSON persistence (data/rooms.json). */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private readonly file?: string;
  private readonly delay: number;

  constructor(opts: RegistryOptions = {}) {
    this.delay = opts.persistDelayMs ?? 250;
    if (opts.dataDir) {
      mkdirSync(opts.dataDir, { recursive: true });
      this.file = path.join(opts.dataDir, "rooms.json");
      this.load();
    }
  }

  create(name: string, rule?: AgreementRule): Room {
    let id = newRoomId();
    while (this.rooms.has(id)) id = newRoomId();
    const room = Room.create({ id, name, rule });
    this.rooms.set(id, room);
    this.markDirty();
    return room;
  }

  get(id: string): Room | undefined {
    return ROOM_ID.test(id) ? this.rooms.get(id) : undefined;
  }

  markDirty(): void {
    if (!this.file || this.timer || this.disposed) return;
    this.timer = setTimeout(() => this.flush(), this.delay);
    this.timer.unref();
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.file) return;
    const data: RoomState[] = [...this.rooms.values()].map((r) => r.snapshot());
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e) {
      // A failed snapshot must never take the realtime server down.
      console.error("[registry] could not persist rooms:", (e as Error).message);
    }
  }

  /** Final flush; afterwards no further timers are armed. */
  dispose(): void {
    this.flush();
    this.disposed = true;
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    const data = JSON.parse(readFileSync(this.file, "utf8")) as RoomState[];
    for (const s of data) {
      // Nobody is connected after a restart.
      s.participants.forEach((p) => (p.connected = false));
      this.rooms.set(s.id, Room.restore(s));
    }
  }
}
