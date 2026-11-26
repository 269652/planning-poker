"use client";
import { useEffect, useState } from "react";
import type { JiraBoard, JiraIssue, JiraSprint } from "@/jira/types";

async function api<T>(roomId: string, token: string | undefined, path: string): Promise<T> {
  const res = await fetch(`/api/rooms/${roomId}/jira${path}`, { headers: { "x-participant-token": token ?? "" } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export default function JiraImport({ roomId, token, existingKeys, onClose, onImport }: {
  roomId: string; token?: string; existingKeys: string[]; onClose: () => void; onImport: (keys: string[]) => void;
}) {
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [scope, setScope] = useState<string>("backlog");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => {
    guard(async () => { setBoards((await api<{ boards: JiraBoard[] }>(roomId, token, "/boards")).boards); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boardId === null) return;
    guard(async () => {
      setSprints((await api<{ sprints: JiraSprint[] }>(roomId, token, `/boards/${boardId}/sprints`)).sprints);
      setScope("backlog");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (boardId === null) return;
    guard(async () => {
      const q = scope === "backlog" ? "" : `?sprintId=${scope}`;
      setIssues((await api<{ issues: JiraIssue[] }>(roomId, token, `/boards/${boardId}/issues${q}`)).issues);
      setPicked(new Set());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, scope]);

  const selectable = issues.filter((i) => !existingKeys.includes(i.key));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Import from Jira">
        <h2>Import from Jira</h2>
        <div className="row">
          <select className="grow" value={boardId ?? ""} onChange={(e) => setBoardId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Select a board…</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.type})</option>)}
          </select>
          <select className="grow" value={scope} onChange={(e) => setScope(e.target.value)} disabled={boardId === null}>
            <option value="backlog">Backlog</option>
            {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.state})</option>)}
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted small">Loading…</p>}
        <ul className="issues">
          {issues.map((i) => {
            const already = existingKeys.includes(i.key);
            return (
              <li key={i.key}>
                <label className="check">
                  <input
                    type="checkbox" disabled={already} checked={picked.has(i.key)}
                    onChange={(e) => { const s = new Set(picked); e.target.checked ? s.add(i.key) : s.delete(i.key); setPicked(s); }}
                  />
                  <span className="key">{i.key}</span>
                  <span className="grow">{i.summary}</span>
                  <span className="muted small">{already ? "on board" : i.estimate !== null ? `${i.estimate} pts` : "unestimated"}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="row end">
          {selectable.length > 0 && (
            <button className="link" onClick={() => setPicked(picked.size === selectable.length ? new Set() : new Set(selectable.map((i) => i.key)))}>
              {picked.size === selectable.length ? "Clear" : "Select all"}
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={picked.size === 0} onClick={() => onImport([...picked])}>Import {picked.size || ""}</button>
        </div>
      </div>
    </div>
  );
}
