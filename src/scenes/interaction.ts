export interface Pulse {
  /** Normalized device coordinates (-1…1, y up). */
  x: number;
  y: number;
  /** Seconds since the pulse started. */
  age: number;
  strength: number;
  /** 0…1 hue used to tint the pulse. */
  hue: number;
}

export const MAX_PULSES = 8;
const PULSE_LIFE = 4;

/**
 * Everything the background scenes react to: the cursor, pulses (clicks, typing, card picks) and
 * the room's mood (harmony after agreement, turbulence after a split vote, flashes for events).
 */
export class Interaction {
  pointer = { x: 0, y: 0 };
  pointerSpeed = 0;
  pulses: Pulse[] = [];
  /** Rises with activity, decays over a few seconds. */
  energy = 0;
  harmony = 0;
  turbulence = 0;
  shimmer = 0;
  sparkle = 0;
  private target = { harmony: 0, turbulence: 0 };
  private w = 1;
  private h = 1;
  private last: { x: number; y: number; t: number } | null = null;

  /** @param intensity scales every pulse (calm mode for people who prefer reduced motion). */
  constructor(private readonly intensity = 1) {}

  resize(width: number, height: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
  }

  toNdc(px: number, py: number): { x: number; y: number } {
    return { x: (px / this.w) * 2 - 1, y: 1 - (py / this.h) * 2 };
  }

  pointerAt(px: number, py: number, timeSec: number): void {
    const p = this.toNdc(px, py);
    if (this.last && timeSec > this.last.t) {
      const v = Math.hypot(p.x - this.last.x, p.y - this.last.y) / (timeSec - this.last.t);
      this.pointerSpeed = Math.min(8, this.pointerSpeed * 0.6 + v * 0.4);
    }
    this.last = { ...p, t: timeSec };
    this.pointer = p;
  }

  pulse(px: number, py: number, rawStrength: number, hue: number): void {
    const strength = rawStrength * this.intensity;
    const p = this.toNdc(px, py);
    this.pulses.push({ ...p, age: 0, strength, hue });
    if (this.pulses.length > MAX_PULSES) this.pulses.splice(0, this.pulses.length - MAX_PULSES);
    this.energy = Math.min(1.5, this.energy + strength * 0.35);
  }

  setMood(m: { harmony?: number; turbulence?: number }): void {
    if (m.harmony !== undefined) this.target.harmony = m.harmony;
    if (m.turbulence !== undefined) this.target.turbulence = m.turbulence;
  }

  flash(kind: "shimmer" | "sparkle"): void {
    this[kind] = 1;
  }

  update(dt: number): void {
    for (const p of this.pulses) p.age += dt;
    this.pulses = this.pulses.filter((p) => p.age < PULSE_LIFE);
    const decay = (v: number, rate: number) => v * Math.exp(-rate * dt);
    this.energy = decay(this.energy, 0.8);
    this.pointerSpeed = decay(this.pointerSpeed, 2);
    this.shimmer = decay(this.shimmer, 0.9);
    this.sparkle = decay(this.sparkle, 1.4);
    const ease = 1 - Math.exp(-1.2 * dt);
    this.harmony += (this.target.harmony - this.harmony) * ease;
    this.turbulence += (this.target.turbulence - this.turbulence) * ease;
  }
}
