"use client";
import { useEffect, useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";
import type { ConnStatus, SocketError } from "@/ui/useRoomSocket";
import ParticipantsPanel from "./ParticipantsPanel";
import TicketList from "./TicketList";
import RoundPanel from "./RoundPanel";
import JiraImport from "./JiraImport";

interface Props {
  view: RoomView;
  status: ConnStatus;
  token?: string;
  error: SocketError | null;
  dismissError: () => void;
  send: (m: ClientMessage) => void;
  shareUrl: string;
}

export default function Board({ view, status, token, error, dismissError, send, shareUrl }: Props) {
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const isHost = view.hostId === view.you;
  const me = view.participants.find((p) => p.id === view.you);
  const current = view.tickets.find((t) => t.id === view.currentTicketId) ?? null;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(dismissError, 6000);
    return () => clearTimeout(t);
  }, [error, dismissError]);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>{view.name}</h1>
          <span className="muted small">Rule: {view.rule === "unanimous" ? "unanimous" : "adjacent (±1 card)"} · you are {isHost ? "the host" : me?.role === "observer" ? "observing" : "a voter"}</span>
        </div>
        <div className="topbar-right">
          <span className={`dot ${status === "open" ? "on" : "off"}`} title={status} />
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy link", shareUrl); }
            }}
          >
            {copied ? "Copied!" : `Invite · ${view.id}`}
          </button>
          {isHost && (
            <select value={view.rule} onChange={(e) => send({ type: "setRule", rule: e.target.value as "unanimous" | "adjacent" })} aria-label="Agreement rule">
              <option value="unanimous">Unanimous</option>
              <option value="adjacent">Adjacent</option>
            </select>
          )}
        </div>
      </header>

      {status !== "open" && <div className="banner">Connection lost — reconnecting…</div>}
      {error && (
        <div className="toast" role="alert" onClick={dismissError}>{error.message}</div>
      )}

      <div className="layout">
        <aside>
          <TicketList view={view} isHost={isHost} send={send} onImport={() => setImporting(true)} />
        </aside>
        <main>
          <RoundPanel view={view} ticket={current} isHost={isHost} isObserver={me?.role === "observer"} send={send} />
        </main>
        <aside>
          <ParticipantsPanel view={view} isHost={isHost} send={send} />
        </aside>
      </div>

      {importing && (
        <JiraImport
          roomId={view.id}
          token={token}
          existingKeys={view.tickets.map((t) => t.key).filter(Boolean) as string[]}
          onClose={() => setImporting(false)}
          onImport={(keys) => { send({ type: "importJira", issueKeys: keys }); setImporting(false); }}
        />
      )}
    </div>
  );
}
