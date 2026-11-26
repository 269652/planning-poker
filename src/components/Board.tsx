"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";
import type { HelperStatus } from "@/jira/helper";
import type { JiraGateway } from "@/jira/types";
import type { HostState } from "@/net/relay";
import type { ConnStatus, SocketError } from "@/ui/useRoom";
import { ticketQueue } from "@/ui/queue";
import { writebackToasts, type Toast } from "@/ui/toasts";
import { emitScene, pulseFrom } from "@/scenes/bus";
import { flashTitle, playChime } from "@/ui/chime";
import { sceneEventsFor } from "@/scenes/events";
import { firstTryUnanimous } from "@/ui/celebrate";
import Fireworks from "./Fireworks";
import BackgroundToggle from "./BackgroundToggle";
import ParticipantsPanel from "./ParticipantsPanel";
import SideTabs from "./SideTabs";
import RoundPanel from "./RoundPanel";
import VotePanel from "./VotePanel";
import JiraImport from "./JiraImport";

interface Props {
  view: RoomView;
  status: ConnStatus;
  error: SocketError | null;
  dismissError: () => void;
  send: (m: ClientMessage) => void;
  shareUrl: string;
  hosting: boolean;
  hostPeer: HostState;
  helper: HelperStatus;
  jira: JiraGateway | null;
  retryHelper: () => void;
  nudged: { from: string; id: number } | null;
  images: Record<string, string>;
}

const PEER_LABEL: Record<HostState, { text: string; tone: string; title: string }> = {
  registering: { text: "Opening room…", tone: "", title: "Connecting to the relay" },
  online: { text: "Open for guests", tone: "good", title: "Guests can join with the invite link while this tab stays open" },
  taken: { text: "Hosted elsewhere", tone: "bad", title: "This room is now hosted in another tab or browser. Reload this tab to host it here again." },
  offline: { text: "Reconnecting…", tone: "bad", title: "Lost the connection to the relay; reconnecting. Guests re-join automatically." },
};

export default function Board({ view, status, error, dismissError, send, shareUrl, hosting, hostPeer, helper, jira, retryHelper, nudged, images }: Props) {
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toasts, setToasts] = useState<(Toast & { n: number })[]>([]);
  const prevView = useRef<RoomView | null>(null);
  const toastSeq = useRef(0);
  const [fireworks, setFireworks] = useState<number | null>(null);
  const fireworksSeq = useRef(0);
  const isHost = view.hostId === view.you;
  const me = view.participants.find((p) => p.id === view.you);
  const queue = useMemo(() => ticketQueue(view), [view]);

  const push = useCallback((t: Toast) => {
    const n = ++toastSeq.current;
    setToasts((ts) => [...ts.filter((x) => x.id !== t.id), { ...t, n }].slice(-4));
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.n !== n)), t.tone === "bad" ? 9000 : 5000);
  }, []);
  const close = (n: number) => setToasts((ts) => ts.filter((x) => x.n !== n));

  // Room changes: write-back toasts for everyone, and moods for the living background.
  useEffect(() => {
    writebackToasts(prevView.current, view).forEach(push);
    sceneEventsFor(prevView.current, view).forEach(emitScene);
    const party = firstTryUnanimous(prevView.current, view);
    if (party) {
      setFireworks(++fireworksSeq.current);
      push({ id: `party:${party}`, tone: "good", message: "🎆 Everyone agreed on the first try!" });
      pulseFrom(document.querySelector(".round-panel, main"), 1.5, 0.14);
    }
    prevView.current = view;
  }, [view, push]);

  // Someone is waiting for my vote: chime, toast, a ripple from the cards, a blinking tab title.
  useEffect(() => {
    if (!nudged) return;
    playChime();
    flashTitle("🔔 Your vote, please");
    push({ id: `nudge:${nudged.id}`, tone: "neutral", message: `🔔 ${nudged.from} is waiting for your vote` });
    pulseFrom(document.querySelector(".vote-panel"), 1.2, 0.12);
  }, [nudged, push]);

  useEffect(() => {
    if (!error) return;
    push({ id: `err:${error.id}`, tone: "bad", message: error.message });
    dismissError();
  }, [error, dismissError, push]);

  const onImport = useCallback(() => setImporting(true), []);
  const closeImport = useCallback(() => setImporting(false), []);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <Link href="/" className="small back">← All sessions</Link>
          <h1>{view.name}</h1>
          <span className="muted small">
            {view.board && <>Board <b>{view.board.name}</b> · </>}
            Rule: {view.rule === "unanimous" ? "unanimous" : "adjacent (±1 card)"} · you are {isHost ? "the host" : me?.role === "observer" ? "observing" : "a voter"}
          </span>
        </div>
        <div className="topbar-right">
          <BackgroundToggle />
          {hosting
            ? <span className={`chip ${PEER_LABEL[hostPeer].tone}`} title={PEER_LABEL[hostPeer].title}>{PEER_LABEL[hostPeer].text}</span>
            : <span className={`dot ${status === "open" ? "on" : "off"}`} title={status === "open" ? "Connected to the host" : "Not connected to the host"} />}
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

      {!hosting && status !== "open" && (
        <div className="banner">{status === "host-offline" ? "The host is offline — the room continues when they reopen it. Retrying…" : "Connection to the host lost — reconnecting…"}</div>
      )}
      {hosting && (
        <div className="host-note small">
          <span>You host this room: it runs in this tab — keep it open during the session.</span>
          <span className={`helper-chip ${helper.state === "connected" ? "good" : "bad"}`}>
            {helper.state === "connected" && <>Jira: signed in as <b>{helper.user}</b></>}
            {helper.state === "checking" && "Jira: checking helper…"}
            {helper.state === "offline" && <>Jira helper not running — import and write-back paused. <button className="link small" onClick={retryHelper}>Retry</button></>}
            {helper.state === "jira-error" && <>Jira helper cannot sign in: {helper.error} <button className="link small" onClick={retryHelper}>Retry</button></>}
          </span>
        </div>
      )}

      <div className="layout">
        <aside className="col-left">
          <SideTabs view={view} queue={queue} isHost={isHost} send={send} onImport={onImport} images={images} />
        </aside>
        <main>
          <RoundPanel view={view} ticket={queue.current} next={queue.next} remaining={queue.upNext.length} isHost={isHost} send={send} />
        </main>
        <aside className="col-right">
          <VotePanel ticket={queue.current} me={me ?? null} send={send} />
          <ParticipantsPanel
            view={view}
            voting={!!queue.current && queue.current.status === "open" && queue.current.rounds.at(-1)?.status === "voting"}
            send={send}
          />
        </aside>
      </div>

      <Fireworks show={fireworks} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.n} className={`toast ${t.tone}`} onClick={() => close(t.n)}>
            <span aria-hidden>{t.tone === "good" ? "✓" : t.tone === "bad" ? "⚠" : "ℹ"}</span> {t.message}
          </div>
        ))}
      </div>

      {importing && (
        <JiraImport
          jira={jira}
          board={view.board}
          existingKeys={view.tickets.map((t) => t.key).filter(Boolean) as string[]}
          onClose={closeImport}
          onImport={(keys) => { send({ type: "importJira", issueKeys: keys }); setImporting(false); }}
        />
      )}
    </div>
  );
}
