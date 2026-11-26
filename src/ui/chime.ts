"use client";
/**
 * A short, friendly two-note chime for "someone is waiting for your vote", synthesised with the
 * Web Audio API (no sound file). Browsers only allow audio after the person interacted with the
 * page, so the audio context is created on the first click/keypress (joining a room needs one).
 */
let ctx: AudioContext | null = null;

function unlock() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio available */ }
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown"] as const) window.addEventListener(ev, unlock, { passive: true });
}

export function playChime(): void {
  unlock();
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.18;
  out.connect(ctx.destination);
  // E5 then A5, soft attack, gentle decay.
  [[659.25, 0], [880, 0.14]].forEach(([freq, at]) => {
    const osc = ctx!.createOscillator();
    const env = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t0 + at);
    env.gain.linearRampToValueAtTime(1, t0 + at + 0.015);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.55);
    osc.connect(env).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.6);
  });
}

/** While the tab is in the background, the title blinks until the person comes back. */
export function flashTitle(text: string): void {
  if (typeof document === "undefined" || !document.hidden) return;
  const original = document.title;
  let on = false;
  const timer = setInterval(() => { on = !on; document.title = on ? text : original; }, 900);
  const stop = () => { clearInterval(timer); document.title = original; document.removeEventListener("visibilitychange", stop); };
  document.addEventListener("visibilitychange", stop);
}
