const KEY = "poker:background";
/** Fired on window when the animated background is switched on/off (detail: boolean). */
export const BACKGROUND_EVENT = "poker:background-change";

function local(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Whether this browser shows the animated background. On unless switched off. */
export function backgroundEnabled(storage: Storage | null = local()): boolean {
  try { return storage?.getItem(KEY) !== "off"; } catch { return true; }
}

export function setBackgroundEnabled(on: boolean, storage: Storage | null = local(), target: EventTarget = window): void {
  try { storage?.setItem(KEY, on ? "on" : "off"); } catch { /* not remembered, still applied */ }
  target.dispatchEvent(new CustomEvent(BACKGROUND_EVENT, { detail: on }));
}
