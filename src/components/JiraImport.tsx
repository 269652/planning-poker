"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomBoard } from "@/core/room";
import { MAX_DESCRIPTION_CHARS, MAX_STREAM_ISSUES, type StreamPayload } from "@/core/protocol";
import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint } from "@/jira/types";
import { GhostLayer, detailScroll, locate, type Spot } from "@/ui/ghosts";
import type { StreamStore } from "@/ui/streamStore";
import BoardPicker from "./BoardPicker";
import { JiraDescription } from "./TicketCard";

/**
 * Host or PM: browses Jira (the host through its helper, a PM through the host) and picks tickets.
 * With "Stream" on, everyone else sees this list live: checkboxes, scrolling and a ghost cursor.
 */
export default function JiraImport({ jira, board: roomBoard, existingKeys, onClose, onImport, onStream, streams }: {
  jira: JiraGateway | null; board: RoomBoard | null; existingKeys: string[];
  onClose: () => void; onImport: (keys: string[]) => void;
  /** Sends stream messages to the room (host or PM). */
  onStream?: (p: StreamPayload) => void;
  /** While streaming: the viewers' cursors (shown faded in this dialog). */
  streams?: StreamStore;
}) {
  const [board, setBoard] = useState<JiraBoard | null>(roomBoard);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [scope, setScope] = useState<string>(roomBoard?.type === "scrum" ? "backlog" : "all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const isScrum = board?.type === "scrum";
  const searchBoards = useMemo(() => (jira ? (q: string) => jira.searchBoards(q) : null), [jira]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Sprints exist only on scrum boards (Jira answers 400 for kanban).
  useEffect(() => {
    setSprints([]);
    if (!board || !jira) return;
    setScope(board.type === "scrum" ? "backlog" : "all");
    if (board.type !== "scrum") return;
    jira.listSprints(board.id).then(setSprints).catch((e) => setError((e as Error).message));
  }, [board, jira]);

  useEffect(() => {
    if (!board || !jira) { setIssues([]); return; }
    const mine = ++seq.current;
    setLoading(true); setError(null);
    const q = query.trim();
    const opts = q ? { query: q } : scope === "all" ? { scope: "all" as const } : scope === "backlog" ? {} : { sprintId: Number(scope) };
    const t = setTimeout(async () => {
      try {
        const r = await jira.listIssues(board.id, opts);
        if (mine === seq.current) setIssues(r);
      } catch (e) {
        if (mine === seq.current) { setError((e as Error).message); setIssues([]); }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [board, scope, query, jira]);

  const selectable = issues.filter((i) => !existingKeys.includes(i.key));
  const allPicked = selectable.length > 0 && selectable.every((i) => picked.has(i.key));
  const toggle = (key: string, on: boolean) => setPicked((p) => { const s = new Set(p); if (on) s.add(key); else s.delete(key); return s; });

  // ---- an opened row: the ticket's description ---------------------------------------------------
  const [expanded, setExpanded] = useState<{ key: string; text: string | null; error?: string } | null>(null);
  const openRow = async (key: string) => {
    if (expanded?.key === key) { setExpanded(null); return; }
    setExpanded({ key, text: null });
    try {
      const [issue] = jira ? await jira.getIssues([key]) : [];
      setExpanded((e) => (e?.key === key ? { key, text: issue?.description ?? "" } : e));
    } catch (err) {
      setExpanded((e) => (e?.key === key ? { key, text: null, error: (err as Error).message } : e));
    }
  };

  // ---- streaming to everyone -------------------------------------------------------------------
  const [streaming, setStreaming] = useState(false);
  const modal = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pointer = useRef<Spot>({ x: 0.5, y: 0.3 });
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const streamRef = useRef(onStream);
  streamRef.current = onStream;
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  // The list, checkboxes and search text whenever they change, a little debounced.
  useEffect(() => {
    if (!streaming || !onStream) return;
    const scopeLabel = query.trim() ? "search across all open issues" : scope === "all" ? "all open issues" : scope === "backlog" ? "backlog" : sprints.find((s) => String(s.id) === scope)?.name ?? "sprint";
    const t = setTimeout(() => onStream({
      kind: "list",
      list: {
        title: board ? `${board.name} · ${scopeLabel}` : "Choosing a board…",
        query,
        filters: {
          board: board?.name ?? "",
          from: scope === "all" ? "All open issues on the board" : scope === "backlog" ? "Backlog"
            : (() => { const s = sprints.find((x) => String(x.id) === scope); return s ? `${s.name} (${s.state})` : ""; })(),
          searching: !!query.trim(),
        },
        issues: issues.slice(0, MAX_STREAM_ISSUES).map((i) => ({
          key: i.key, summary: i.summary, issueType: i.issueType, status: i.status, estimate: i.estimate, inSession: existingKeys.includes(i.key),
        })),
        picked: [...picked].slice(0, MAX_STREAM_ISSUES),
        ...(expanded && expanded.text !== null ? { expanded: { key: expanded.key, text: expanded.text.slice(0, MAX_DESCRIPTION_CHARS) } } : {}),
      },
    }), 100);
    return () => clearTimeout(t);
  }, [streaming, onStream, issues, picked, board, scope, query, sprints, existingKeys, expanded]);

  // Stop streaming when the dialog closes.
  useEffect(() => () => { if (streamingRef.current) streamRef.current?.({ kind: "end" }); }, []);

  /** Cursor (relative to the row/part under it) and list scroll, at most ~30×/s (trailing update included). */
  const sendPointer = () => {
    const el = list.current;
    if (!streamingRef.current || !el || !onStream) return;
    const send = () => {
      lastSent.current = performance.now();
      const max = el.scrollHeight - el.clientHeight;
      // Anchor the scroll to the row at the top, so the viewer shows the list from the same ticket.
      const top = [...el.querySelectorAll<HTMLElement>("li[data-key]")].find((li) => li.offsetTop + li.offsetHeight > el.scrollTop);
      const anchor = top ? { topRow: top.dataset.key, topOff: (el.scrollTop - top.offsetTop) / Math.max(1, top.offsetHeight) } : {};
      const ds = detailScroll(modal.current);
      onStream({ kind: "pointer", pointer: { ...pointer.current, scroll: max > 0 ? el.scrollTop / max : 0, ...anchor, ...(ds !== undefined ? { detailScroll: ds } : {}) } });
    };
    clearTimeout(pending.current);
    const wait = 33 - (performance.now() - lastSent.current);
    if (wait <= 0) send(); else pending.current = setTimeout(send, wait);
  };
  /**
   * Where the mouse is, relative to the row (or named part of the dialog) under it. Re-done on every
   * move *and* every scroll: scrolling with the wheel moves another row under a resting mouse.
   */
  const lastClient = useRef<{ x: number; y: number } | null>(null);
  const relocate = () => {
    const c = lastClient.current;
    if (modal.current && c) pointer.current = locate(modal.current, c.x, c.y);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    lastClient.current = { x: e.clientX, y: e.clientY };
    relocate();
    sendPointer();
  };
  const onListScroll = () => { relocate(); sendPointer(); };

  // The viewers' cursors, in this dialog too (faded): everyone sees everyone.
  const layer = useMemo(() => new GhostLayer(() => modal.current), []);
  useEffect(() => {
    if (!streaming || !streams) { layer.clear(); return; }
    const off = streams.onPointer((p, who) => layer.place(who.from, who.name, p, true));
    const prune = setInterval(() => layer.prune(15_000), 3000);
    return () => { off(); clearInterval(prune); layer.clear(); };
  }, [streaming, streams, layer]);
  // Rows re-rendered (new results, an opened row): put the ghosts back into their rows.
  useEffect(() => { layer.refresh(); }, [issues, expanded, layer]);
  const toggleStream = () => {
    if (streaming) onStream?.({ kind: "end" });
    setStreaming(!streaming);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modal} className={`modal panel import ${streaming ? "streaming" : ""}`} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Import from Jira"
        onPointerMove={onPointerMove}
      >
        <div className="ticket-head" data-anchor="head">
          <h2>Add tickets to the session</h2>
          <div className="row" style={{ marginTop: 0 }}>
            {onStream && (
              <button
                className={`small stream-btn ${streaming ? "on" : ""}`} onClick={toggleStream} aria-pressed={streaming}
                title={streaming ? "Stop showing this list to everyone" : "Show this list to everyone, live: checkboxes, scrolling and your cursor"}
              >
                {streaming ? <><span className="live-dot" aria-hidden /> Streaming · Stop</> : "📡 Stream to everyone"}
              </button>
            )}
            <button className="link" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="import-filters">
          <label className="grow" data-anchor="board">Board
            <BoardPicker value={board} onChange={(b) => { setBoard(b); setPicked(new Set()); }} search={searchBoards} />
          </label>
          <label className="grow" data-anchor="from">From
            <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!board || !!query.trim()}>
              {isScrum && <option value="backlog">Backlog</option>}
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.state})</option>)}
              <option value="all">All open issues on the board</option>
            </select>
          </label>
        </div>
        {/* The anchor wraps the field exactly (an input can't hold a ghost cursor). */}
        <div className="import-search-wrap" data-anchor="search">
          <input
            type="search" className="import-search" value={query} onChange={(e) => setQuery(e.target.value)} disabled={!board}
            placeholder={board ? `Search ${board.name} by text or key, e.g. ${existingKeys[0]?.split("-")[0] ?? "PROJ"}-123…` : "Pick a board first"}
            aria-label="Search tickets" autoFocus={!!board}
          />
        </div>
        {!jira && <p className="error small">The Jira helper is not connected — start it on this computer to browse Jira (see the start page).</p>}
        {query.trim() && <p className="muted small">Searching all open issues on the board (up to 50 hits).</p>}
        {error && <p className="error small">{error}</p>}

        {/* Only the list scrolls; the header, filters and buttons stay in place. */}
        <ul className="issues" ref={list} onScroll={onListScroll} data-anchor="list">
          {loading && issues.length === 0 && <li className="muted small">Loading…</li>}
          {!loading && board && issues.length === 0 && !error && <li className="muted small">{query.trim() ? "No open tickets match." : "No open tickets here."}</li>}
          {issues.map((i) => {
            const already = existingKeys.includes(i.key);
            const open = expanded?.key === i.key;
            return (
              <li key={i.key} data-key={i.key} className={`${already ? "already" : ""} ${open ? "open" : ""}`}>
                <label className="check">
                  <button
                    type="button" className="row-toggle" aria-expanded={open} aria-label={open ? `Close ${i.key}` : `Show what ${i.key} is about`}
                    onClick={(e) => { e.preventDefault(); void openRow(i.key); }}
                  >{open ? "▾" : "▸"}</button>
                  <input type="checkbox" disabled={already} checked={picked.has(i.key)} onChange={(e) => toggle(i.key, e.target.checked)} />
                  <span className="key">{i.key}</span>
                  <span className="grow">{i.summary}</span>
                  <span className="muted small nowrap">{i.issueType}{i.status ? ` · ${i.status}` : ""}</span>
                  <span className="muted small nowrap">{already ? "in session" : i.estimate !== null ? `${i.estimate} pts` : "–"}</span>
                </label>
                {open && (
                  <div className="row-detail" onScroll={onListScroll}>
                    {/* The whole text: cursors anchor to it, so they move with it while it scrolls. */}
                    <div className="row-detail-text" data-detail={i.key}>
                      {expanded.error ? <p className="error small">{expanded.error}</p>
                        : expanded.text === null ? <p className="muted small">Loading…</p>
                        : <JiraDescription text={expanded.text} />}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="row end" data-anchor="foot">
          {selectable.length > 0 && (
            <button className="link" onClick={() => setPicked(allPicked ? new Set() : new Set([...picked, ...selectable.map((i) => i.key)]))}>
              {allPicked ? "Clear" : `Select all ${selectable.length}`}
            </button>
          )}
          <span className="grow muted small">{picked.size > 0 ? `${picked.size} selected — added to the queue in this order` : ""}</span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={picked.size === 0} onClick={() => onImport([...picked])}>Add {picked.size || ""} to session</button>
        </div>
      </div>
    </div>
  );
}
