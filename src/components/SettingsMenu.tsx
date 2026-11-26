"use client";
import { useEffect, useRef, useState } from "react";
import type { AgreementRule } from "@/core/stats";
import BackgroundToggle from "./BackgroundToggle";

const RULES: { value: AgreementRule; label: string; hint: string }[] = [
  { value: "unanimous", label: "Unanimous", hint: "Everyone plays the same card" },
  { value: "adjacent", label: "Adjacent", hint: "Cards within one step count as agreement" },
];

/** A gear button with a popover: the animated background (this browser) and the agreement rule (host). */
export default function SettingsMenu({ rule, isHost, onRule }: {
  rule: AgreementRule; isHost: boolean; onRule: (rule: AgreementRule) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button
        type="button" className="icon-btn" aria-label="Settings" aria-haspopup="dialog" aria-expanded={open}
        title="Settings" onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="popover settings-pop" role="dialog" aria-label="Settings">
          <h4>Agreement rule</h4>
          <div className="rule-options" role="radiogroup" aria-label="Agreement rule">
            {RULES.map((r) => (
              <label key={r.value} className={`rule-option ${rule === r.value ? "on" : ""} ${isHost ? "" : "readonly"}`}>
                <input type="radio" name="rule" value={r.value} checked={rule === r.value} disabled={!isHost} onChange={() => onRule(r.value)} />
                <span><b>{r.label}</b><span className="muted small">{r.hint}</span></span>
              </label>
            ))}
          </div>
          {!isHost && <p className="muted small">Only the host can change the rule.</p>}
          <h4>Appearance</h4>
          <BackgroundToggle />
          <p className="muted small">Saved in this browser only.</p>
        </div>
      )}
    </div>
  );
}
