"use client";
import { useEffect, useState } from "react";
import { BACKGROUND_EVENT, backgroundEnabled, setBackgroundEnabled } from "@/ui/preferences";

/** Switches the animated background on/off for this browser (on by default). */
export default function BackgroundToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    setOn(backgroundEnabled());
    const onChange = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(BACKGROUND_EVENT, onChange);
    return () => window.removeEventListener(BACKGROUND_EVENT, onChange);
  }, []);

  return (
    <button
      type="button"
      className="bg-toggle small"
      role="switch"
      aria-checked={on}
      title={on ? "Turn the animated background off" : "Turn the animated background on"}
      onClick={() => setBackgroundEnabled(!on)}
    >
      <span className={`switch ${on ? "on" : ""}`} aria-hidden /> Animated background
    </button>
  );
}
