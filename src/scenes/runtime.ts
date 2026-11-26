import * as THREE from "three";
import { onScene, type SceneEvent } from "./bus";
import { feelRects, type FeltElement } from "./feel";
import { Interaction } from "./interaction";
import { organismParams } from "./moods";
import { Organism } from "./organism";

/** UI elements the organism perceives as bodies (it grows around them and is drawn to their edges). */
const FEEL = [
  ".panel", ".topbar > div", ".landing-head > *", ".board-group > h3", ".landing-grid > section > h2",
  ".banner", ".host-note", ".toast", ".home > h1", ".home > p",
].join(", ");
const FRAME_MS = 1000 / 30;
const STEPS_PER_FRAME = 2;

/**
 * Runs the living background: one organism that grows around the UI and reacts to the cursor,
 * clicks, typing, cards, raised hands and the room's mood. Returns a stop function.
 */
export function startLivingBackground(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean; debug?: boolean }): () => void {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, powerPreference: "low-power",
    // Debug only: lets headless screenshots capture the canvas.
    preserveDrawingBuffer: !!opts.debug,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const organism = new Organism(renderer);
  const calm = opts.reducedMotion;
  const s = new Interaction(calm ? 0.55 : 1);
  const lightQuery = window.matchMedia?.("(prefers-color-scheme: light)");
  let light = lightQuery?.matches ?? false;
  const onTheme = () => { light = lightQuery.matches; };
  lightQuery?.addEventListener?.("change", onTheme);

  let width = 1, height = 1;
  let hovered: Element | null = null;
  const boosted = new Map<Element, number>(); // e.g. the People panel after a raised hand
  let fieldDirty = true;
  let lastField = 0;
  let clock = 0;

  // ---- perceiving the UI ------------------------------------------------------------------------
  const drawField = () => {
    fieldDirty = false;
    lastField = clock;
    const focused = document.activeElement?.closest(FEEL) ?? null;
    const els: FeltElement[] = [];
    for (const el of document.querySelectorAll(FEEL)) {
      const boost = (boosted.get(el) ?? 0) > clock;
      els.push({
        rect: el.getBoundingClientRect(),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 4,
        hovered: el === hovered || boost,
        focused: el === focused || boost,
      });
    }
    const rects = feelRects(els, { width, height }, { width: organism.simW, height: organism.simH });
    const ctx = organism.fieldCtx;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, organism.simW, organism.simH);
    ctx.globalCompositeOperation = "lighter";
    for (const r of rects) {
      // Scent around the edge: a soft green halo, stronger where you are working.
      ctx.shadowColor = `rgba(0,255,0,${Math.min(1, 0.3 * r.interest)})`;
      ctx.shadowBlur = 4 + 3 * r.interest;
      ctx.strokeStyle = `rgba(0,${Math.min(255, 70 * r.interest)},0,1)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, r.radius + 1.5);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgb(255,0,0)";
    for (const r of rects) { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.radius); ctx.fill(); }
    organism.fieldChanged();
  };

  const resize = () => {
    width = window.innerWidth; height = window.innerHeight;
    // The background is soft by design: on large (4K) screens render fewer pixels and let the
    // browser upscale, keeping the per-pixel shader work within ~2.5 million pixels.
    const budget = Math.sqrt(2_500_000 / Math.max(1, width * height));
    renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.25, budget)));
    renderer.setSize(width, height, false);
    s.resize(width, height);
    organism.resize(width, height);
    fieldDirty = true;
  };

  // ---- the room's events --------------------------------------------------------------------------
  const centre = () => ({ x: width / 2, y: height / 2 });
  const handle = (e: SceneEvent) => {
    switch (e.kind) {
      case "pulse": s.pulse(e.x, e.y, e.strength, e.hue ?? (clock * 0.05) % 1); break;
      case "burst": s.pulse(e.x, e.y, e.strength, e.hue); organism.startle(1); break;
      case "reveal": {
        const c = centre();
        s.pulse(c.x, c.y, 1.4, e.agreed ? 0.11 : 0.78);
        s.setMood(e.agreed ? { harmony: 1, turbulence: 0 } : { harmony: 0.1, turbulence: Math.min(1, e.spread / 5) });
        break;
      }
      case "new-round": s.setMood({ harmony: 0, turbulence: 0 }); break;
      case "settle": { const c = centre(); s.setMood({ harmony: 1, turbulence: 0 }); s.pulse(c.x, c.y, 1, 0.12); break; }
      case "shimmer": s.flash("shimmer"); break;
      case "sparkle": s.flash("sparkle"); break;
      case "hand": {
        // Reach for the person who raised their hand.
        const row = document.querySelector(`[data-participant="${CSS.escape(e.participantId)}"]`);
        if (row) {
          const r = row.getBoundingClientRect();
          s.pulse(r.left + r.width / 2, r.top + r.height / 2, 1.6, 0.12);
          const panel = row.closest(FEEL);
          if (panel) { boosted.set(panel, clock + 8); fieldDirty = true; }
        }
        s.energy = Math.min(1.5, s.energy + 0.5);
        break;
      }
      case "next-scene": { const c = centre(); s.setMood({ harmony: 0, turbulence: 0 }); s.pulse(c.x, c.y, 1.2, (clock * 0.07) % 1); break; }
    }
  };
  const offBus = onScene(handle);

  // ---- the person in front of the screen ----------------------------------------------------------
  const onMove = (e: PointerEvent) => {
    s.pointerAt(e.clientX, e.clientY, performance.now() / 1000);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(FEEL) ?? null;
    if (over !== hovered) { hovered = over; fieldDirty = true; }
  };
  const onDown = (e: PointerEvent) => s.pulse(e.clientX, e.clientY, 0.5, (clock * 0.05 + e.clientX / width * 0.3) % 1);
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (e.key.length !== 1 && e.key !== "Enter" && e.key !== "Backspace")) return;
    const r = el.getBoundingClientRect();
    const input = el as HTMLInputElement;
    const caret = typeof input.selectionStart === "number" ? input.selectionStart : (input.value?.length ?? 0);
    const x = Math.min(r.right - 8, r.left + 12 + caret * 7.5);
    s.pulse(x, r.top + r.height / 2, e.key === "Enter" ? 0.8 : 0.25, e.key === "Enter" ? 0.12 : (e.key.charCodeAt(0) % 24) / 24);
  };
  const markDirty = () => { fieldDirty = true; };
  // The organism lives on the page: when the page scrolls, it scrolls along.
  let scrollPos = { x: window.scrollX, y: window.scrollY };
  // Page scroll is read once per animation frame (see `loop`), in step with what the browser paints.
  const syncScroll = (): boolean => {
    const now = { x: window.scrollX, y: window.scrollY };
    if (now.x === scrollPos.x && now.y === scrollPos.y) return false;
    organism.scroll(now.x - scrollPos.x, now.y - scrollPos.y, width, height);
    scrollPos = now;
    fieldDirty = true;
    return true;
  };
  const onScroll = () => { fieldDirty = true; };
  // The page changing (things appearing, moving) startles the feelers too.
  const mo = new MutationObserver(() => { fieldDirty = true; organism.startle(0.6); });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "open"] });
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("focusin", markDirty);
  window.addEventListener("focusout", markDirty);
  window.addEventListener("resize", resize);
  resize();
  drawField();

  // ---- life ---------------------------------------------------------------------------------------
  let frames = 0;
  const frame = (dt: number) => {
    clock += dt;
    syncScroll();
    s.update(dt);
    if (fieldDirty || clock - lastField > 1) drawField();
    const p = organismParams(clock, s);
    for (let i = 0; i < STEPS_PER_FRAME; i++) organism.step(clock, p, s);
    organism.draw(clock, s, light, width / height, calm);
    frames++;
    if (opts.debug && (frames === 1 || frames % 15 === 0)) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4 * 64);
      gl.readPixels(Math.floor(gl.drawingBufferWidth * 0.05), Math.floor(gl.drawingBufferHeight / 2), 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0, sum = 0;
      for (let i = 0; i < 64; i++) { const v = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]; sum += v; if (v > 120) lit++; }
      const b = canvas.getBoundingClientRect();
      const cs = getComputedStyle(canvas);
      const top = document.elementFromPoint(20, height - 20);
      canvas.dataset.organism = `frames=${frames} sim=${organism.simW}x${organism.simH} lit=${lit}/64 avg=${Math.round(sum / 64)}`
        + ` box=${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.left)},${Math.round(b.top)} opacity=${cs.opacity} vis=${cs.visibility}`
        + ` top=${top?.tagName}.${(top as HTMLElement)?.className || ""} buf=${canvas.width}x${canvas.height}`;
      if (frames % 15 === 0) canvas.dataset.snapshot = canvas.toDataURL("image/jpeg", 0.8);
    }
  };

  let raf = 0;
  let last = 0;
  let stopped = false;
  let debugTimer: ReturnType<typeof setInterval> | undefined;
  // Headless test browsers may never fire animation frames; in debug mode a timer keeps it alive.
  const debugQuery = new URLSearchParams(window.location.search);
  if (opts.debug && !debugQuery.has("raf")) {
    let ticks = 0;
    debugTimer = setInterval(() => {
      // `?debug&poke`: drive the real event path with a synthetic cursor circling in the lower left and a click every 3 s.
      if (debugQuery.has("poke")) {
        ticks++;
        const a = ticks * 0.05;
        const x = width * 0.18 + Math.cos(a) * width * 0.08, y = height * 0.75 + Math.sin(a) * height * 0.12;
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
        if (ticks % 90 === 0) window.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y }));
      }
      if (performance.now() - last > 200) frame(1 / 30);
    }, 33);
  }
  // Always alive. (Windows with "animation effects" off makes browsers report reduced motion; the
  // organism then stays in calm mode — softer ripples, no twinkling — instead of freezing.)
  frame(1 / 30);
  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const scrolled = syncScroll();
    if (now - last < FRAME_MS) {
      // Between simulation ticks, still redraw while scrolling so the organism glides with the page.
      if (scrolled) organism.draw(clock, s, light, width / height, calm);
      return;
    }
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 30);
    last = now;
    frame(dt);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    offBus();
    mo.disconnect();
    lightQuery?.removeEventListener?.("change", onTheme);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, { capture: true });
    clearInterval(debugTimer);
    window.removeEventListener("focusin", markDirty);
    window.removeEventListener("focusout", markDirty);
    window.removeEventListener("resize", resize);
    organism.dispose();
    renderer.dispose();
  };
}
