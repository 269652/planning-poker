"use client";
import { useEffect, useRef, useState } from "react";
import { BACKGROUND_EVENT, backgroundEnabled } from "@/ui/preferences";

/**
 * The living background: a slime-mould organism (three.js, loaded lazily) that grows around the UI
 * and reacts to the cursor, clicks, typing and what happens in the room. Can be switched off per
 * browser (BackgroundToggle); then nothing is loaded. `?debug` exposes a rendered pixel probe on
 * the canvas (data-organism). Without WebGL the plain page background stays.
 */
export default function Backdrop() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(backgroundEnabled());
    const onChange = (e: Event) => setEnabled((e as CustomEvent<boolean>).detail);
    window.addEventListener(BACKGROUND_EVENT, onChange);
    return () => window.removeEventListener(BACKGROUND_EVENT, onChange);
  }, []);

  return enabled ? <LivingCanvas /> : null;
}

function LivingCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const test = document.createElement("canvas");
    if (!test.getContext("webgl2") && !test.getContext("webgl")) return;
    void import("@/scenes/runtime").then(({ startLivingBackground }) => {
      if (cancelled) return;
      try {
        const debug = new URLSearchParams(window.location.search).has("debug");
        stop = startLivingBackground(el, {
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
          debug,
        });
        setInstant(debug);
        setReady(true);
      } catch (e) {
        console.warn("[backdrop] WebGL background unavailable", e);
      }
    });
    return () => { cancelled = true; stop?.(); };
  }, []);

  return (
    <div className={`backdrop ${ready ? "ready" : ""} ${instant ? "pinned" : ""}`} aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
