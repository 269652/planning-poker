'use client';
import { useState } from 'react';
import { NUMERIC_SCALE, type Card } from '@/core/deck';
import type { RoomView, TicketView } from '@/core/view';
import type { ClientAction } from '@/hooks/useRoom';
import Hand from './Hand';
import RoundHistory from './RoundHistory';
import { cardLabel } from './cards';

interface Props {
  view: RoomView;
  ticket: TicketView | undefined;
  isHost: boolean;
  jiraEnabled: boolean;
  act: (a: ClientAction) => void;
  writeBack: (ticketId: string) => void;
}

export default function Stage({ view, ticket, isHost, jiraEnabled, act, writeBack }: Props) {
  const [force, setForce] = useState<number | ''>('');
  const me = view.participants.find((p) => p.id === view.you);

  if (!ticket) {
    return (
      <section className="panel stage empty">
        <h2>{isHost ? 'Pick a ticket to estimate' : 'Waiting for the host…'}</h2>
        <p className="muted">{isHost ? 'Select one from the backlog.' : 'The host will start the next ticket.'}</p>
      </section>
    );
  }

  const round = ticket.rounds[ticket.rounds.length - 1];
  const voting = ticket.status === 'voting';
  const revealed = ticket.status === 'revealed';
  const agreed = ticket.status === 'agreed';
  const showFaces = revealed || agreed;
  const voters = view.participants.filter((p) => p.role === 'voter' && (p.connected || p.hasVoted));
  const votedCount = voters.filter((p) => p.hasVoted).length;
  const stats = round.stats;
  const idx = view.tickets.findIndex((t) => t.id === ticket.id);
  const next = [...view.tickets.slice(idx + 1), ...view.tickets.slice(0, idx)].find((t) => t.status !== 'agreed' && t.status !== 'skipped');

  return (
    <div className="stage-col">
      <section className="panel stage">
        <header className="ticket-head">
          <div>
            <div className="ticket-top">
              {ticket.key && (ticket.url ? <a className="key" href={ticket.url} target="_blank" rel="noreferrer">{ticket.key} ↗</a> : <span className="key">{ticket.key}</span>)}
              <span className="badge neutral">Round {round.number}</span>
              {ticket.currentEstimate !== null && <span className="badge neutral" title="Estimate currently in Jira">Jira: {ticket.currentEstimate}</span>}
            </div>
            <h2>{ticket.title}</h2>
          </div>
        </header>
        {ticket.description && <p className="desc">{ticket.description}</p>}

        <div className="seats">
          {view.participants.filter((p) => p.role === 'voter').map((p) => (
            <div key={p.id} className={`seat ${p.connected ? '' : 'away'}`}>
              <div className={`face ${showFaces && p.vote !== null ? 'up' : p.hasVoted ? 'down' : 'empty'}`}>
                {showFaces && p.vote !== null ? cardLabel(p.vote) : p.hasVoted ? '' : '…'}
              </div>
              <div className="who">{p.id === view.hostId ? '👑 ' : ''}{p.name}{p.id === view.you ? ' (you)' : ''}</div>
            </div>
          ))}
        </div>
        {view.participants.some((p) => p.role === 'observer') && (
          <p className="muted small-text">Observing: {view.participants.filter((p) => p.role === 'observer').map((p) => p.name).join(', ')}</p>
        )}

        {voting && (
          <div className="controls">
            <span className="muted">{votedCount}/{voters.length} voted</span>
            {isHost && (
              <>
                <button className="primary" disabled={votedCount === 0} onClick={() => act({ type: 'reveal' })}>Reveal cards</button>
                <button onClick={() => act({ type: 'revote' })} disabled={votedCount === 0}>Clear votes</button>
                <button className="ghost" onClick={() => act({ type: 'skip' })}>Skip ticket</button>
              </>
            )}
          </div>
        )}

        {(revealed || agreed) && stats && (
          <div className="results">
            <div className="chips">
              <Chip k="Median" v={stats.median ?? '–'} />
              <Chip k="Average" v={stats.mean === null ? '–' : stats.mean.toFixed(1)} />
              <Chip k="Spread" v={stats.spreadSteps === null ? '–' : `${stats.spreadSteps} step${stats.spreadSteps === 1 ? '' : 's'}`} />
              <Chip k="Agreement" v={`${Math.round(stats.agreement * 100)}%`} />
              {stats.unsureCount > 0 && <Chip k="Unsure (?)" v={stats.unsureCount} />}
              {stats.coffeeCount > 0 && <Chip k="Coffee" v={stats.coffeeCount} />}
            </div>
            <div className="dist">
              {[...NUMERIC_SCALE.map(String), '?', 'coffee'].filter((k) => stats.distribution[k]).map((k) => (
                <div key={k} className="dist-row">
                  <span className="dist-card">{cardLabel(k === '?' || k === 'coffee' ? (k as Card) : Number(k) as Card)}</span>
                  <span className="dist-bar" style={{ width: `${(stats.distribution[k] / Math.max(stats.voters, stats.voted)) * 100}%` }} />
                  <span className="dist-n">{stats.distribution[k]}</span>
                </div>
              ))}
            </div>
            {revealed && (stats.consensus ? (
              <p className="ok">Consensus on <b>{stats.consensusValue}</b>.</p>
            ) : (
              <p className="warn">
                No consensus{stats.voted < stats.voters ? ' (not everyone voted)' : stats.unsureCount || stats.coffeeCount ? ' (? or ☕ present)' : ''}. Discuss, then vote again.
              </p>
            ))}
          </div>
        )}

        {revealed && isHost && stats && (
          <div className="controls">
            {stats.consensus ? (
              <>
                <button className="primary" onClick={() => act({ type: 'accept' })}>Accept {stats.consensusValue}{ticket.source === 'jira' && jiraEnabled && view.settings.writeBack === 'auto' ? ' & write to Jira' : ''}</button>
                <button onClick={() => act({ type: 'revote' })}>Vote again</button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => act({ type: 'revote' })}>Start round {round.number + 1}</button>
                <span className="force">
                  <select value={force === '' ? stats.suggested ?? '' : force} onChange={(e) => setForce(Number(e.target.value))} aria-label="Value to force">
                    {NUMERIC_SCALE.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button title="Decide without full consensus" onClick={() => act({ type: 'accept', value: force === '' ? stats.suggested ?? 0 : force })}>Force accept</button>
                </span>
              </>
            )}
          </div>
        )}

        {agreed && (
          <div className="agreed">
            <p className="ok big">
              Agreed: <b>{ticket.estimate}</b> {ticket.resolution === 'forced' ? '(forced by host)' : `in ${ticket.convergence.roundsToAgreement ?? ticket.rounds.length} round${(ticket.convergence.roundsToAgreement ?? ticket.rounds.length) === 1 ? '' : 's'}`}
            </p>
            {ticket.source === 'jira' && (
              <p className={ticket.jira.writeStatus === 'failed' ? 'err' : 'muted'}>
                {ticket.jira.writeStatus === 'written' && `Written to Jira ${ticket.key} ✓`}
                {ticket.jira.writeStatus === 'pending' && 'Writing to Jira…'}
                {ticket.jira.writeStatus === 'failed' && `Jira write failed: ${ticket.jira.error}`}
                {ticket.jira.writeStatus === 'none' && 'Not written to Jira yet.'}
              </p>
            )}
            {isHost && (
              <div className="controls">
                {next && <button className="primary" onClick={() => act({ type: 'selectTicket', ticketId: next.id })}>Next: {next.key ?? next.title.slice(0, 24)}</button>}
                {ticket.source === 'jira' && jiraEnabled && ticket.jira.writeStatus !== 'written' && ticket.jira.writeStatus !== 'pending' && (
                  <button onClick={() => writeBack(ticket.id)}>{ticket.jira.writeStatus === 'failed' ? 'Retry Jira write' : 'Write to Jira'}</button>
                )}
                <button className="ghost" onClick={() => act({ type: 'reopen', ticketId: ticket.id })}>Re-estimate</button>
              </div>
            )}
          </div>
        )}
      </section>

      {me?.role === 'voter' ? (
        <section className="panel">
          <Hand
            selected={me.vote}
            disabled={!voting}
            onPick={(c) => (me.vote === c ? act({ type: 'retract' }) : act({ type: 'vote', card: c }))}
          />
          {!voting && <p className="muted small-text">{agreed ? 'Ticket agreed.' : 'Votes are revealed. Waiting for the next round.'}</p>}
        </section>
      ) : (
        <p className="muted">You are observing. <button className="ghost" onClick={() => act({ type: 'setRole', role: 'voter' })}>Join as voter</button></p>
      )}

      <RoundHistory ticket={ticket} />
    </div>
  );
}

function Chip({ k, v }: { k: string; v: string | number }) {
  return <span className="chip"><span className="muted">{k}</span> <b>{v}</b></span>;
}
