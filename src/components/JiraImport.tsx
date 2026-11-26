'use client';
import { useEffect, useState } from 'react';

interface Board { id: number; name: string; type: string }
interface Sprint { id: number; name: string; state: string }
type JiraCall = <T = any>(op: Record<string, unknown> & { op: string }) => Promise<T>;

export default function JiraImport({ jira, mode, onClose }: { jira: JiraCall; mode: string | null; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintId, setSprintId] = useState<number | ''>('');
  const [jql, setJql] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const search = async (q: string) => {
    setBusy(true); setMsg(null);
    try { setBoards(await jira<Board[]>({ op: 'boards', query: q || undefined })); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  useEffect(() => { search(''); /* eslint-disable-next-line */ }, []);

  const pick = async (b: Board) => {
    setBoard(b); setSprintId(''); setSprints([]); setMsg(null);
    try { setSprints(await jira<Sprint[]>({ op: 'sprints', boardId: b.id })); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  const doImport = async () => {
    if (!board) return;
    setBusy(true); setMsg(null);
    try {
      const r = await jira<{ count: number }>({ op: 'import', boardId: board.id, sprintId: sprintId || undefined, jql: jql.trim() || undefined });
      setMsg({ ok: true, text: `Imported ${r.count} ticket${r.count === 1 ? '' : 's'}.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Import from Jira" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h3>Import from Jira {mode === 'mock' && <span className="badge neutral">demo data</span>}</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(query); }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boards…" />
          <button disabled={busy}>Search</button>
        </form>
        <ul className="list">
          {boards?.map((b) => (
            <li key={b.id}>
              <button className={`list-item ${board?.id === b.id ? 'active' : ''}`} onClick={() => pick(b)}>
                {b.name} <span className="muted">{b.type}</span>
              </button>
            </li>
          ))}
          {boards?.length === 0 && <li className="muted pad">No boards found.</li>}
        </ul>
        {board && (
          <div className="stack">
            {sprints.length > 0 && (
              <label>Sprint
                <select value={sprintId} onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Whole board</option>
                  {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.state})</option>)}
                </select>
              </label>
            )}
            <label>Extra JQL filter <span className="muted">(optional, replaces the default)</span>
              <input value={jql} onChange={(e) => setJql(e.target.value)} placeholder='issuetype = Story AND "Story point estimate" is EMPTY' />
            </label>
            <button className="primary" onClick={doImport} disabled={busy}>{busy ? 'Importing…' : `Import from ${board.name}`}</button>
          </div>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
      </div>
    </div>
  );
}
