'use client';
import { useEffect, useState } from 'react';
import { useRoom } from '@/hooks/useRoom';
import Backlog from './Backlog';
import JiraImport from './JiraImport';
import Stage from './Stage';

export default function RoomClient({ roomId, roomName }: { roomId: string; roomName?: string }) {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const n = localStorage.getItem('pp.name');
      if (n) { setName(n); setDraft(n); }
    } catch {}
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!name) {
    return (
      <main className="lobby">
        <h1>Join room <code>{roomId}</code></h1>
        <form className="card-panel" onSubmit={(e) => { e.preventDefault(); const n = draft.trim(); if (n) { try { localStorage.setItem('pp.name', n); } catch {} setName(n); } }}>
          <label>Your name<input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} /></label>
          <button className="primary" disabled={!draft.trim()}>Join</button>
        </form>
      </main>
    );
  }
  return <Room roomId={roomId} roomName={roomName} name={name} />;
}

function Room({ roomId, roomName, name }: { roomId: string; roomName?: string; name: string }) {
  const { view, status, error, act, jira } = useRoom(roomId, name, roomName);
  const [importing, setImporting] = useState(false);
  const [jiraInfo, setJiraInfo] = useState<{ enabled: boolean; mode: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status === 'open' && view) jira<{ enabled: boolean; mode: string | null }>({ op: 'status' }).then(setJiraInfo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, !!view]);

  if (!view) return <main className="lobby"><p className="muted">{status === 'open' ? 'Joining…' : 'Connecting…'}</p></main>;

  const isHost = view.hostId === view.you;
  const jiraEnabled = !!jiraInfo?.enabled;
  const ticket = view.tickets.find((t) => t.id === view.currentTicketId);
  const me = view.participants.find((p) => p.id === view.you);

  return (
    <div className="room">
      <header className="topbar">
        <div>
          <h1>{view.name}</h1>
          <span className="muted">Room <code>{roomId}</code> · {view.participants.filter((p) => p.connected).length} online</span>
        </div>
        <div className="top-actions">
          <span className={`dot-status ${status}`} title={status}>{status === 'open' ? 'Live' : 'Reconnecting…'}</span>
          <button onClick={() => { navigator.clipboard?.writeText(location.href.split('?')[0]).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            {copied ? 'Copied ✓' : 'Copy invite link'}
          </button>
          {me && <button className="ghost" onClick={() => act({ type: 'setRole', role: me.role === 'voter' ? 'observer' : 'voter' })}>{me.role === 'voter' ? 'Observe' : 'Vote'}</button>}
        </div>
      </header>

      {isHost && (
        <div className="settings">
          <label className="check"><input type="checkbox" checked={view.settings.autoReveal} onChange={(e) => act({ type: 'setSettings', autoReveal: e.target.checked })} /> Auto-reveal when everyone voted</label>
          {jiraEnabled && (
            <label className="check">Jira write-back
              <select value={view.settings.writeBack} onChange={(e) => act({ type: 'setSettings', writeBack: e.target.value as 'auto' | 'manual' })}>
                <option value="auto">automatic on agreement</option>
                <option value="manual">manual</option>
              </select>
            </label>
          )}
          <label className="check">Host
            <select value={view.hostId ?? ''} onChange={(e) => act({ type: 'transferHost', to: e.target.value })}>
              {view.participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {error && <div className="toast" role="alert">{error}</div>}

      <div className="layout">
        <Backlog view={view} isHost={isHost} jiraEnabled={jiraEnabled} act={act} onImport={() => setImporting(true)} />
        <Stage
          view={view}
          ticket={ticket}
          isHost={isHost}
          jiraEnabled={jiraEnabled}
          act={act}
          writeBack={(ticketId) => jira({ op: 'writeBack', ticketId }).catch(() => {})}
        />
      </div>
      {importing && <JiraImport jira={jira} mode={jiraInfo?.mode ?? null} onClose={() => setImporting(false)} />}
    </div>
  );
}
