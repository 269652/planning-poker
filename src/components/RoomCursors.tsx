"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardSpot, ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";
import { BoardCursors, locateBoard, type PresenceStore } from "@/ui/presence";
import { throttle } from "@/ui/ghosts";

/**
 * Everyone's mouse in the room: yours is sent (≤ 10×/s, as the spot in your window; over the card
 * pane only "in the cards"), the others' are shown at the same spot of this window (vw/vh).
 * Renders nothing itself (except the `?debug-cursors` readout).
 */
export default function RoomCursors({ presence, send, view }: {
  presence: PresenceStore; send: (m: ClientMessage) => void; view: RoomView;
}) {
  const layer = useMemo(() => new BoardCursors(), []);
  // `?debug-cursors`: a small readout of what is sent and received (to find out where it stops).
  const [debug] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug-cursors"));
  const [stats, setStats] = useState({ sent: 0, received: 0, recent: [] as { at: number; text: string }[], shown: 0, max: 0, where: "–" });
  const bump = useRef((u: { sentInc?: number; recvInc?: number; last?: string }) => {
    if (!debug) return;
    setStats((s) => ({
      ...s,
      sent: s.sent + (u.sentInc ?? 0), received: s.received + (u.recvInc ?? 0),
      recent: u.last ? [{ at: Date.now(), text: u.last }, ...s.recent].slice(0, 4) : s.recent,
    }));
  });
  // Live: how many foreign cursors are on screen right now, and where the first one sits.
  useEffect(() => {
    if (!debug) return;
    const t = setInterval(() => {
      const all = [...document.querySelectorAll<HTMLElement>(".board-cursor")];
      const c = all[0];
      const r = c?.getBoundingClientRect();
      const where = c ? `${c.parentElement?.dataset.cursorSlot ?? c.parentElement?.tagName} · ${c.className} · ${Math.round(r!.left)},${Math.round(r!.top)} · ${getComputedStyle(c).display}/${getComputedStyle(c).visibility}/${getComputedStyle(c).opacity}` : "–";
      setStats((s) => ({ ...s, shown: all.length, max: Math.max(s.max, all.length), where }));
    }, 250);
    return () => clearInterval(t);
  }, [debug]);

  // The others.
  useEffect(() => {
    const off = presence.on((from, name, spot) => {
      layer.place(from, name, spot);
      bump.current({ recvInc: 1, last: `${name}: ${spot ? (spot.cards ? "cards" : `${(spot.x * 100).toFixed(1)}vw ${(spot.y * 100).toFixed(1)}vh`) : "gone"}` });
    });
    return () => { off(); layer.clear(); };
  }, [presence, layer]);
  // Drop the cursors of people who left.
  useEffect(() => {
    layer.retain(new Set(view.participants.filter((p) => p.connected && p.id !== view.you).map((p) => p.id)), 60_000);
  }, [view, layer]);

  // Yours.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    let sentNull = true;
    const post = throttle<BoardSpot | null>(100, (spot) => {
      if (!spot && sentNull) return;
      sentNull = !spot;
      sendRef.current({ type: "cursor", spot });
      bump.current({ sentInc: 1 });
    });
    const update = () => { if (last && document.visibilityState === "visible") post(locateBoard(last.x, last.y)); };
    const onMove = (e: PointerEvent) => { if (e.pointerType !== "touch") { last = { x: e.clientX, y: e.clientY }; update(); } };
    const gone = () => { last = null; post(null); };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) gone(); };
    const onVisibility = () => { if (document.visibilityState !== "visible") gone(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut);
    document.addEventListener("visibilitychange", onVisibility);
    // Scrolling moves another element under a resting mouse.
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("blur", gone);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("blur", gone);
      post(null);
    };
  }, []);

  if (!debug) return null;
  return (
    <div className="cursor-debug small">
      cursors · sent {stats.sent} · received {stats.received} · shown {stats.shown} (max {stats.max})<br />
      where: {stats.where}<br />
      {stats.recent.map((r, i) => <span key={i}>{((Date.now() - r.at) / 1000).toFixed(1)}s ago: {r.text}<br /></span>)}
      hover:none={String(typeof window !== "undefined" && window.matchMedia("(hover: none)").matches)} · visible={typeof document !== "undefined" ? document.visibilityState : "?"}
    </div>
  );
}
