"use client";
import { useEffect, useRef } from "react";
import { emitScene } from "@/scenes/bus";

type Shell = "peony" | "ring" | "willow" | "crossette" | "chrysanthemum" | "heart";

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; hue: number; light: number; size: number;
  drag: number; gravity: number; strobe: boolean; split: boolean; trail: number;
  px: number; py: number;
}
interface Rocket { x: number; y: number; vx: number; vy: number; hue: number; burstAt: number; shell: Shell; scale: number }

const SHOW_MS = 6500;
const SHELLS: Shell[] = ["peony", "ring", "willow", "crossette", "chrysanthemum", "heart"];
const PALETTE = [45, 330, 190, 280, 140, 10, 210]; // gold, pink, cyan, violet, green, red, blue

/**
 * A firework show over the page: varied shells (peonies, rings, golden willows, splitting crossettes,
 * chrysanthemums, a heart), a crackling finale, and every burst rippling through the living background.
 * Re-runs whenever `show` changes to a new non-null value.
 */
export default function Fireworks({ show }: { show: string | number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (show === null) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Reduced motion: fewer shells, no strobing or screen flash — still a celebration.
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scale = Math.min(1.4, Math.max(0.7, Math.min(W, H) / 700));

    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    let flash = 0;

    // The schedule: an opening volley, a steady show, and a finale of many shells at once.
    const plan: { at: number; shell?: Shell }[] = [];
    const main = calm ? 6 : 12;
    for (let i = 0; i < main; i++) plan.push({ at: 150 + i * (calm ? 650 : 360) + Math.random() * 180 });
    plan.push({ at: (calm ? 4200 : 4600), shell: "heart" });
    const finale = calm ? 4 : 10;
    for (let i = 0; i < finale; i++) plan.push({ at: (calm ? 4900 : 5100) + Math.random() * 500 });
    plan.sort((a, b) => a.at - b.at);

    const launch = (shell?: Shell) => {
      const x = W * (0.12 + Math.random() * 0.76);
      const burstAt = H * (0.12 + Math.random() * 0.33);
      // Launch speed so the shell peaks around its burst height.
      const vy = -Math.sqrt(2 * 0.14 * (H - burstAt)) * (0.95 + Math.random() * 0.1);
      rockets.push({
        x, y: H + 8, vx: (W / 2 - x) * 0.0012 + (Math.random() - 0.5) * 0.6, vy,
        hue: PALETTE[Math.floor(Math.random() * PALETTE.length)] + (Math.random() - 0.5) * 16,
        burstAt, shell: shell ?? SHELLS[Math.floor(Math.random() * 5)], scale: scale * (0.85 + Math.random() * 0.4),
      });
    };

    const spark = (x: number, y: number, a: number, speed: number, hue: number, o: Partial<Spark> = {}) => {
      const max = o.max ?? 60 + Math.random() * 40;
      sparks.push({
        x, y, px: x, py: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: max, max, hue, light: 65,
        size: 1.6, drag: 0.968, gravity: 0.06, strobe: false, split: false, trail: 0.9, ...o,
      });
    };

    const burst = (r: Rocket) => {
      const s = r.scale;
      const n = Math.round((calm ? 70 : 130) * s);
      switch (r.shell) {
        case "ring": {
          const tilt = Math.random() * Math.PI, squash = 0.35 + Math.random() * 0.5;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const cx = Math.cos(a), cy = Math.sin(a) * squash;
            const ax = cx * Math.cos(tilt) - cy * Math.sin(tilt), ay = cx * Math.sin(tilt) + cy * Math.cos(tilt);
            spark(r.x, r.y, Math.atan2(ay, ax), 5.2 * s * Math.hypot(ax, ay), r.hue, { size: 2 });
          }
          // A second, inner ring in a contrasting colour.
          for (let i = 0; i < n / 2; i++) spark(r.x, r.y, (i / (n / 2)) * Math.PI * 2, 2.6 * s, r.hue + 150, { size: 1.6 });
          break;
        }
        case "willow":
          for (let i = 0; i < n; i++) {
            spark(r.x, r.y, Math.random() * Math.PI * 2, (1 + Math.random() * 3.4) * s, 42, {
              max: 130 + Math.random() * 60, drag: 0.985, gravity: 0.035, light: 60, size: 1.4, trail: 0.96, strobe: !calm && Math.random() < 0.3,
            });
          }
          break;
        case "crossette":
          for (let i = 0; i < Math.round(n / 5); i++) {
            spark(r.x, r.y, Math.random() * Math.PI * 2, (2.5 + Math.random() * 2.5) * s, r.hue, { max: 34 + Math.random() * 10, split: true, size: 2.2 });
          }
          break;
        case "chrysanthemum":
          for (let i = 0; i < n; i++) {
            spark(r.x, r.y, Math.random() * Math.PI * 2, (0.5 + Math.random()) * 4.6 * s, r.hue + (Math.random() - 0.5) * 40, {
              trail: 0.97, strobe: !calm && Math.random() < 0.4, size: 1.5,
            });
          }
          break;
        case "heart":
          for (let i = 0; i < n * 1.2; i++) {
            const t = (i / (n * 1.2)) * Math.PI * 2;
            const hx = 16 * Math.sin(t) ** 3;
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            spark(r.x, r.y, Math.atan2(hy, hx), Math.hypot(hx, hy) * 0.3 * s, 340, { size: 2.2, gravity: 0.03, max: 90 });
          }
          break;
        default: // peony: a full sphere, with a glittering core in a second colour
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = Math.cbrt(Math.random()) * 5 * s;
            spark(r.x, r.y, a, sp, r.hue + (Math.random() - 0.5) * 20, { size: 1.9 });
          }
          for (let i = 0; i < n / 3; i++) {
            spark(r.x, r.y, Math.random() * Math.PI * 2, Math.random() * 1.8 * s, r.hue + 180, { size: 1.2, strobe: !calm, max: 50 });
          }
      }
      if (!calm) flash = Math.min(0.12, flash + 0.07);
      // The organism feels it: a ripple in the shell's colour from where it burst.
      emitScene({ kind: "burst", x: r.x, y: r.y, strength: 0.9 + 0.5 * s, hue: (((r.hue % 360) + 360) % 360) / 360 });
    };

    // Opening: the background glows golden and shimmers along with the show.
    emitScene({ kind: "settle" });
    emitScene({ kind: "shimmer" });
    if (!calm) emitScene({ kind: "sparkle" });

    const start = performance.now();
    let next = 0;
    let raf = 0;
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      frame++;
      while (next < plan.length && t >= plan[next].at) launch(plan[next++].shell);

      // Fade what was drawn (keeps the page visible underneath): long, glowing streaks.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      if (flash > 0.005) {
        ctx.fillStyle = `rgba(255,240,210,${flash})`;
        ctx.fillRect(0, 0, W, H);
        flash *= 0.8;
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        const ox = r.x, oy = r.y;
        r.x += r.vx; r.y += r.vy; r.vy += 0.14;
        ctx.strokeStyle = `hsla(${r.hue}, 80%, 75%, 0.9)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(r.x, r.y); ctx.stroke();
        // Sparkling exhaust.
        if (frame % 2 === 0) spark(r.x, r.y, Math.PI / 2 + (Math.random() - 0.5), Math.random(), 35, { max: 18, size: 1, gravity: 0.03 });
        if (r.y <= r.burstAt || r.vy >= -0.5) { burst(r); rockets.splice(i, 1); }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.px = s.x; s.py = s.y;
        s.x += s.vx; s.y += s.vy;
        s.vx *= s.drag; s.vy = s.vy * s.drag + s.gravity;
        s.life--;
        if (s.life <= 0) {
          // Crossettes split into four smaller stars when they burn out.
          if (s.split) for (let k = 0; k < 4; k++) spark(s.x, s.y, k * Math.PI / 2 + Math.random() * 0.4, 2.2, s.hue + 30, { max: 40, size: 1.5 });
          sparks.splice(i, 1);
          continue;
        }
        const k = s.life / s.max;
        if (s.strobe && k < 0.6 && (frame + i) % 4 < 2) continue;
        const alpha = Math.min(1, k * 1.4);
        ctx.strokeStyle = `hsla(${s.hue}, 95%, ${s.light + 25 * k}%, ${alpha * 0.55})`;
        ctx.lineWidth = s.size * (0.5 + 0.6 * k);
        ctx.beginPath(); ctx.moveTo(s.px - s.vx * 2 * s.trail, s.py - s.vy * 2 * s.trail); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.fillStyle = `hsla(${s.hue}, 100%, ${Math.min(95, s.light + 30 * k)}%, ${alpha})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.6 + 0.7 * k), 0, Math.PI * 2); ctx.fill();
      }

      if (t < SHOW_MS || rockets.length || sparks.length) raf = requestAnimationFrame(tick);
      else { ctx.clearRect(0, 0, W, H); emitScene({ kind: "sparkle" }); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [show]);

  return <canvas ref={ref} className="fireworks" aria-hidden />;
}
