export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Smooth, slowly wandering value in [-1, 1] (sum of incommensurate sines). */
export function drift(t: number, seed = 0): number {
  return 0.5 * Math.sin(t * 0.37 + seed * 1.7) + 0.3 * Math.sin(t * 0.23 + seed * 2.9 + 1.3) + 0.2 * Math.sin(t * 0.11 + seed * 4.1 + 2.1);
}

/** Safe bounds of the slime-mould parameters (beyond them the organism dies out or turns to noise). */
export const PARAM_RANGES = {
  sensorAngle: [0.2, 1.2],  // radians between forward and side sensors
  sensorDist: [4, 24],      // simulation pixels
  turn: [0.1, 0.9],         // radians per step
  speed: [0.5, 2.6],        // simulation pixels per step
  wander: [0, 0.8],         // random turning
  decay: [0.85, 0.985],     // trail kept per step
  deposit: [0.02, 0.2],     // trail laid per agent and step
} as const;

export type OrganismParams = { [K in keyof typeof PARAM_RANGES]: number };

const clamp = (k: keyof typeof PARAM_RANGES, v: number) => Math.min(PARAM_RANGES[k][1], Math.max(PARAM_RANGES[k][0], v));

/**
 * The organism's behaviour at time t (seconds). On its own it drifts over minutes between dense
 * networks, long veins and dotted swarms; agreement (harmony) makes it calm and flowing, a split
 * vote (turbulence) restless and fragmented, activity (energy) quick.
 */
export function organismParams(t: number, mood: { harmony: number; turbulence: number; energy: number }): OrganismParams {
  const { harmony: h, turbulence: u, energy: e } = mood;
  // Rates are chosen so the organism visibly changes character within a minute or two.
  const d = (seed: number, rate: number) => drift(t * rate * 2.2, seed);
  // A slow, gentle pulse in how far and wide it senses: the cells breathe and now and then split or
  // merge, but stay an ordered, tissue-like foam.
  const pulse = Math.sin(t * 0.42) * 0.6 + Math.sin(t * 0.17 + 1.3) * 0.4;
  // Agreement (h) only nudges it towards calm, flowing veins: strong settings (slow-fading trails,
  // no wandering, huge cells) froze the tissue for as long as the agreement lasted.
  return {
    sensorAngle: clamp("sensorAngle", (0.62 + 0.28 * d(1, 0.02)) * (1 - 0.15 * h) * (1 + 0.08 * pulse) + 0.2 * u),
    sensorDist: clamp("sensorDist", 10 + 3 * d(2, 0.017) + 1.2 * pulse + 2 * h - 3 * u),
    turn: clamp("turn", 0.38 + 0.12 * d(3, 0.023) + 0.35 * u - 0.04 * h),
    speed: clamp("speed", 1.05 + 0.25 * d(4, 0.019) + 0.6 * Math.min(e, 1.5) + 0.3 * u),
    wander: clamp("wander", 0.12 + 0.05 * d(5, 0.029) + 0.5 * u - 0.04 * h),
    decay: clamp("decay", 0.93 + 0.015 * d(6, 0.013) + 0.01 * h - 0.04 * u),
    deposit: clamp("deposit", 0.055 + 0.02 * d(7, 0.021)),
  };
}
