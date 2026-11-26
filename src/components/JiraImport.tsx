"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomBoard } from "@/core/room";
import type { JiraBoard, JiraGateway, JiraIssue, JiraSprint } from "@/jira/types";
import BoardPicker from "./BoardPicker";

/** Host-only: browses Jira through the host's own connection (the local Jira helper). */
export default function JiraImport({ jira, board: roomBoard, existingKeys, onClose, onImport }: {
  jira: JiraGateway | null; board: RoomBoard | null; existingKeys: string[];
  onClose: () => void; onImport: (keys: string[]) => void;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel import" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Import from Jira">
        <div className="ticket-head">
          <h2>Add tickets to the session</h2>
          <button className="link" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="import-filters">
          <label className="grow">Board
            <BoardPicker value={board} onChange={(b) => { setBoard(b); setPicked(new Set()); }} search={searchBoards} />
          </label>
          <label className="grow">From
            <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!board || !!query.trim()}>
              {isScrum && <option value="backlog">Backlog</option>}
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.state})</option>)}
              <option value="all">All open issues on the board</option>
            </select>
          </label>
        </div>
        <input
          type="search" className="import-search" value={query} onChange={(e) => setQuery(e.target.value)} disabled={!board}
          placeholder={board ? `Search ${board.name} by text or key, e.g. ${existingKeys[0]?.split("-")[0] ?? "PROJ"}-123…` : "Pick a board first"}
          aria-label="Search tickets" autoFocus={!!board}
        />
        {!jira && <p className="error small">The Jira helper is not connected — start it on this computer to browse Jira (see the start page).</p>}
        {query.trim() && <p className="muted small">Searching all open issues on the board (up to 50 hits).</p>}
        {error && <p className="error small">{error}</p>}

        <ul className="issues">
          {loading && issues.length === 0 && <li className="muted small">Loading…</li>}
          {!loading && board && issues.length === 0 && !error && <li className="muted small">{query.trim() ? "No open tickets match." : "No open tickets here."}</li>}
          {issues.map((i) => {
            const already = existingKeys.includes(i.key);
            return (
              <li key={i.key} className={already ? "already" : ""}>
                <label className="check">
                  <input type="checkbox" disabled={already} checked={picked.has(i.key)} onChange={(e) => toggle(i.key, e.target.checked)} />
                  <span className="key">{i.key}</span>
                  <span className="grow">{i.summary}</span>
                  <span className="muted small nowrap">{i.issueType}{i.status ? ` · ${i.status}` : ""}</span>
                  <span className="muted small nowrap">{already ? "in session" : i.estimate !== null ? `${i.estimate} pts` : "–"}</span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="row end">
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
