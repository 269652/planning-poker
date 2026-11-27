"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { StreamPointer } from "@/core/protocol";
import type { StreamStore } from "@/ui/streamStore";
import { GhostLayer, locate, throttle, type Spot } from "@/ui/ghosts";
import { JiraDescription } from "./TicketCard";

/**
 * What everyone else sees while a host/PM streams the Jira import dialog: the same dialog, line for
 * line (header, board, "From", search, list, buttons) but read-only — their checkboxes, the row they
 * opened, their scrolling, and everyone's cursors: the presenter's solid, the other viewers' faded.
 * Your own cursor is streamed too. It can be hidden; a pill brings it back while the stream lasts.
 */
export default function StreamViewer({ store, onPointer }: {
  store: StreamStore;
  /** Streams your own cursor to the others. */
  onPointer?: (spot: Spot) => void;
}) {
  const snap = useSyncExternalStore(store.subscribe, store.get, () => null);
  const [hidden, setHidden] = useState(false);
  const modal = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const layer = useMemo(() => new GhostLayer(() => modal.current), []);
  /** The presenter's last scroll we followed (kept across list updates, so they don't yank yours). */
  const followed = useRef("");
  const followedDetail = useRef("");
  const from = snap?.from;
  // Another row opened: follow its description's scroll from the top again.
  const openKey = snap?.list.expanded?.key;
  useEffect(() => { followedDetail.current = ""; }, [openKey, hidden]);
  const live = !!snap;

  // A new stream (or a new streamer) opens again; reopening the view follows their scroll again.
  useEffect(() => { setHidden(false); }, [from]);
  useEffect(() => { followed.current = ""; }, [from, hidden]);
  useEffect(() => () => layer.clear(), [layer]);
  useEffect(() => { if (!live || hidden) layer.clear(); }, [live, hidden, layer]);

  // Cursors (presenter and viewers) and the presenter's scroll, straight to the DOM.
  useEffect(() => {
    if (!snap || hidden) return;
    const row = (key?: string) => (key ? list.current?.querySelector<HTMLElement>(`li[data-key="${CSS.escape(key)}"]`) ?? null : null);
    /** Scroll: follow the presenter only when *they* scroll (so you can look around in between). */
    const follow = (p: StreamPointer) => {
      const l = list.current;
      const sig = `${p.topRow ?? ""}:${(p.topOff ?? 0).toFixed(3)}:${p.scroll.toFixed(3)}`;
      if (!l || sig === followed.current) return;
      followed.current = sig;
      const top = row(p.topRow);
      if (top) l.scrollTop = top.offsetTop + (p.topOff ?? 0) * top.offsetHeight;
      else { const max = l.scrollHeight - l.clientHeight; if (max > 0) l.scrollTop = p.scroll * max; }
    };
    /** The opened description's own scroll: likewise only when the presenter scrolls it. */
    const followDetail = (p: StreamPointer) => {
      const d = list.current?.querySelector<HTMLElement>(".row-detail");
      if (!d || p.detailScroll === undefined) return;
      const sig = p.detailScroll.toFixed(3);
      if (sig === followedDetail.current) return;
      followedDetail.current = sig;
      const max = d.scrollHeight - d.clientHeight;
      if (max > 0) d.scrollTop = p.detailScroll * max;
    };
    // The list re-rendered: put every ghost back into its row, and the presenter's view position.
    const last = store.pointer();
    if (last) { follow(last); followDetail(last); layer.place(snap.from, snap.name, last, false); }
    layer.refresh();
    const offPointer = store.onPointer((p, who) => {
      if (who.presenter) { follow(p); followDetail(p); }
      layer.place(who.from, who.name, p, !who.presenter);
    });
    const offEnd = store.onEnd((id) => layer.remove(id));
    const prune = setInterval(() => layer.prune(15_000), 3000);
    return () => { offPointer(); offEnd(); clearInterval(prune); };
  }, [snap, hidden, store, layer]);

  // Your own cursor, for the others (they see it faded).
  const sendMine = useMemo(() => (onPointer ? throttle<Spot>(66, onPointer) : null), [onPointer]);

  useEffect(() => {
    if (!snap || hidden) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHidden(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap, hidden]);

  if (!snap) return null;
  if (hidden) {
    return (
      <button className="stream-pill" onClick={() => setHidden(false)} title={`Watch ${snap.name}'s Jira list again`}>
        <span className="live-dot" aria-hidden /> {snap.name} is showing Jira tickets · Watch
      </button>
    );
  }

  const { list: l } = snap;
  const picked = new Set(l.picked);
  const f = l.filters;
  return (
    <div className="modal-backdrop" onClick={() => setHidden(true)}>
      <div
        ref={modal} className="modal panel import stream-view" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${snap.name}'s Jira list (live)`}
        onPointerMove={(e) => { if (sendMine && modal.current) sendMine(locate(modal.current, e.clientX, e.clientY)); }}
      >
        {/* Same rows as the streamer's dialog, so everything sits at the same height. */}
        <div className="ticket-head" data-anchor="head">
          <h2>{snap.name}&apos;s Jira tickets</h2>
          <div className="row" style={{ marginTop: 0 }}>
            <span className="small stream-btn on as-button"><span className="live-dot" aria-hidden /> Live</span>
            <button className="link" onClick={() => setHidden(true)} aria-label="Hide">✕</button>
          </div>
        </div>
        <div className="import-filters">
          <label className="grow" data-anchor="board">Board
            <div className="combo"><div className="combo-input"><input value={f?.board ?? l.title} readOnly tabIndex={-1} /></div></div>
          </label>
          <label className="grow" data-anchor="from">From
            <select value="x" disabled tabIndex={-1} onChange={() => {}}><option value="x">{f?.from || "–"}</option></select>
          </label>
        </div>
        {/* What they're typing, live. The anchor wraps the field exactly (an input can't hold a ghost). */}
        <div className="import-search-wrap" data-anchor="search">
          <input type="search" className="import-search" value={l.query} readOnly tabIndex={-1} placeholder="Not searching" aria-label={`${snap.name}'s search`} />
        </div>
        {(f ? f.searching : !!l.query.trim()) && <p className="muted small">Searching all open issues on the board (up to 50 hits).</p>}

        <ul className="issues" ref={list} data-anchor="list">
          {l.issues.length === 0 && <li className="muted small">Nothing listed yet…</li>}
          {l.issues.map((i) => {
            const open = l.expanded?.key === i.key;
            return (
              <li key={i.key} data-key={i.key} className={`${i.inSession ? "already" : ""} ${picked.has(i.key) ? "picked" : ""} ${open ? "open" : ""}`}>
                <label className="check">
                  <span className="row-toggle" aria-hidden>{open ? "▾" : "▸"}</span>
                  <input type="checkbox" disabled checked={picked.has(i.key)} readOnly />
                  <span className="key">{i.key}</span>
                  <span className="grow">{i.summary}</span>
                  <span className="muted small nowrap">{i.issueType}{i.status ? ` · ${i.status}` : ""}</span>
                  <span className="muted small nowrap">{i.inSession ? "in session" : i.estimate !== null ? `${i.estimate} pts` : "–"}</span>
                </label>
                {open && (
                  <div className="row-detail">
                    <div className="row-detail-text" data-detail={i.key}><JiraDescription text={l.expanded!.text} /></div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="row end" data-anchor="foot">
          <span className="grow muted small">{picked.size > 0 ? `${picked.size} selected — live, read-only` : "Live, read-only"}</span>
          <button onClick={() => setHidden(true)}>Hide</button>
        </div>
      </div>
    </div>
  );
}
