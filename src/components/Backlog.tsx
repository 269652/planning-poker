'use client';
import { useState } from 'react';
import type { RoomView, TicketView } from '@/core/view';
import type { ClientAction } from '@/hooks/useRoom';

const STATUS: Record<string, string> = { pending: 'To do', voting: 'Voting', revealed: 'Revealed', agreed: 'Agreed', skipped: 'Skipped' };

function JiraBadge({ t }: { t: TicketView }) {
  if (t.source !== 'jira' || t.status !== 'agreed') return null;
  const s = t.jira.writeStatus;
  if (s === 'written') return <span className="badge good" title="Estimate written to Jira">Jira ✓</span>;
  if (s === 'pending') return <span className="badge neutral">Jira…</span>;
  if (s === 'failed') return <span className="badge bad" title={t.jira.error ?? ''}>Jira ✗</span>;
  return <span className="badge neutral" title="Not written yet">Jira –</span>;
}

export default function Backlog({
  view, isHost, jiraEnabled, act, onImport,
}: { view: RoomView; isHost: boolean; jiraEnabled: boolean; act: (a: ClientAction) => void; onImport: () => void }) {
  const [title, setTitle] = useState('');
  const done = view.tickets.filter((t) => t.status === 'agreed').length;
  const points = view.tickets.reduce((n, t) => n + (t.estimate ?? 0), 0);

  return (
    <aside className="panel backlog">
      <header className="panel-head">
        <h3>Backlog</h3>
        <span className="muted">{done}/{view.tickets.length} · {points} pts</span>
      </header>
      {isHost && (
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { act({ type: 'addTicket', ticket: { title } }); setTitle(''); } }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add ticket…" maxLength={300} />
            <button disabled={!title.trim()}>Add</button>
          </form>
          {jiraEnabled && <button onClick={onImport}>Import from Jira…</button>}
        </div>
      )}
      <ul className="tickets">
        {view.tickets.map((t) => (
          <li key={t.id} className={`ticket ${t.id === view.currentTicketId ? 'current' : ''} st-${t.status}`}>
            <button className="ticket-main" disabled={!isHost || t.status === 'agreed'} onClick={() => act({ type: 'selectTicket', ticketId: t.id })}>
              <span className="ticket-top">
                {t.key && <span className="key">{t.key}</span>}
                <span className="badge neutral">{STATUS[t.status]}</span>
                <JiraBadge t={t} />
              </span>
              <span className="ticket-title">{t.title}</span>
            </button>
            <span className="est">{t.estimate !== null ? t.estimate : t.currentEstimate !== null ? <i title="Existing estimate in Jira">{t.currentEstimate}</i> : '·'}</span>
            {isHost && (
              <button className="ghost small" title="Remove" aria-label={`Remove ${t.title}`} onClick={() => act({ type: 'removeTicket', ticketId: t.id })}>✕</button>
            )}
          </li>
        ))}
        {view.tickets.length === 0 && <li className="muted pad">{isHost ? 'Add tickets or import a board to begin.' : 'Waiting for the host to add tickets.'}</li>}
      </ul>
    </aside>
  );
}
