"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Room } from "@/core/room";
import { newRoomId, parseRoomCode } from "@/core/roomId";
import { gatewayForHelper, probeHelper, type HelperStatus } from "@/jira/helper";
import type { JiraBoard } from "@/jira/types";
import BackgroundToggle from "@/components/BackgroundToggle";
import BoardPicker from "@/components/BoardPicker";
import HelperPanel from "@/components/HelperPanel";
import { relativeTime } from "@/ui/format";
import { DEMO_ENABLED } from "@/ui/site";
import { LocalStore, type SessionEntry } from "@/ui/storage";
import { helperUrl as storedHelperUrl } from "@/ui/useRoom";

interface Group { key: string; board: SessionEntry["board"]; rooms: SessionEntry[] }

/** Sessions grouped by Jira board ("one session per project"), most recent first. */
function groupByBoard(rooms: SessionEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rooms) {
    const key = r.board ? `b${r.board.id}` : "none";
    if (!groups.has(key)) groups.set(key, { key, board: r.board, rooms: [] });
    groups.get(key)!.rooms.push(r);
  }
  return [...groups.values()].sort((a, b) => (a.board ? 0 : 1) - (b.board ? 0 : 1));
}

export default function Home() {
  const router = useRouter();
  const [you, setYou] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [board, setBoard] = useState<JiraBoard | null>(null);
  const [rule, setRule] = useState<"unanimous" | "adjacent">("unanimous");
  const [code, setCode] = useState("");
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [helper, setHelper] = useState<HelperStatus>({ state: "checking" });
  const [helperUrl, setHelperUrl] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const store = LocalStore.browser();
    setSessions(store.sessions());
    setYou(store.getName());
    setHelperUrl(storedHelperUrl());
  }, []);

  // Look for the helper until it is connected (and re-check now and then).
  useEffect(() => {
    if (!helperUrl) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const run = async () => {
      const s = await probeHelper(helperUrl);
      if (!alive) return;
      setHelper(s);
      t = setTimeout(run, s.state === "connected" ? 30_000 : 4_000);
    };
    void run();
    return () => { alive = false; clearTimeout(t); };
  }, [helperUrl, tick]);

  const jira = useMemo(() => (helper.state === "connected" ? gatewayForHelper(helperUrl, helper) : null), [helper, helperUrl]);
  const searchBoards = useMemo(() => (jira ? (q: string) => jira.searchBoards(q) : null), [jira]);
  const groups = useMemo(() => groupByBoard(sessions ?? []), [sessions]);
  const existingForBoard = board ? (sessions ?? []).filter((r) => r.board?.id === board.id && r.hosting) : [];

  const blockers = [
    helper.state !== "connected" && "Start the Jira helper on this computer to host a room (see above).",
    !you.trim() && "Enter your name.",
    !name.trim() && "Enter a session name.",
  ].filter(Boolean) as string[];

  function chooseBoard(b: JiraBoard | null) {
    setBoard(b);
    if (b && !nameTouched) setName(`${b.name} refinement`);
  }

  function create(demo: boolean) {
    const store = LocalStore.browser();
    const id = newRoomId();
    const room = Room.create({ id, name: name.trim() || "Demo session", rule, board: demo ? { id: 2, name: "Demo Kanban Board", type: "kanban" } : board });
    const me = room.join({ name: you.trim() || "Host" });
    store.setName(you.trim() || "Host");
    store.setToken(id, me.token);
    store.saveHostedRoom(room.snapshot());
    if (demo) store.setDemo(id);
    router.push(`/room/#${id}`);
  }

  const parsedCode = parseRoomCode(code);
  const forget = (id: string) => {
    LocalStore.browser().forget(id);
    setSessions(LocalStore.browser().sessions());
  };

  return (
    <main className="landing">
      <header className="landing-head">
        <div className="landing-title">
          <h1>Planning Poker</h1>
          <BackgroundToggle />
        </div>
        <p className="muted">Estimate Jira tickets together, in realtime — one session per board. Rounds repeat until the team agrees, then the estimate is written back to Jira.</p>
      </header>

      <section className="panel how">
        <h2>How it works</h2>
        <ul className="small">
          <li><b>Hosting a room needs the Jira helper</b>, a small program that runs on the host&apos;s computer and is connected to Jira with the host&apos;s credentials. The room itself runs in the host&apos;s browser tab — keep it open during the session.</li>
          <li><b>Guests need nothing</b> but the invite link: no Jira access, no setup. Everyone connects directly to the host (WebRTC); tickets and results are streamed from the host.</li>
        </ul>
        <HelperPanel
          status={helper}
          helperUrl={helperUrl}
          onRetry={() => { setHelper({ state: "checking" }); setTick((n) => n + 1); }}
          onHelperUrl={(u) => { try { localStorage.setItem("poker:helperUrl", u); } catch { /* ignore */ } setHelperUrl(u); setHelper({ state: "checking" }); }}
        />
      </section>

      <div className="landing-grid">
        <section>
          <h2>Your sessions</h2>
          {sessions === null && <p className="muted small">Loading…</p>}
          {sessions?.length === 0 && (
            <div className="panel muted small">No sessions yet. Host one for a board, or join with an invite link — they will show up here.</div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="board-group">
              <h3>
                {g.board ? g.board.name : "Without a board"}
                {g.board && <span className="badge">{g.board.type}</span>}
              </h3>
              <ul className="sessions">
                {g.rooms.map((r) => {
                  const pct = r.ticketCount ? Math.round((r.estimatedCount / r.ticketCount) * 100) : 0;
                  return (
                    <li key={r.id} className="panel session">
                      <Link href={`/room/#${r.id}`} className="session-main">
                        <span className="session-title">
                          <strong>{r.name}</strong>
                          <span className="badge">{r.hosting ? "you host" : "guest"}</span>
                        </span>
                        <span className="muted small">
                          {r.estimatedCount}/{r.ticketCount} estimated · {r.hosting ? "active " : "last seen "}{relativeTime(r.lastActivityAt)}
                        </span>
                        {r.hosting && <span className="small muted">Runs in this browser — open it so guests can join.</span>}
                        <span className="progress" aria-label={`${pct}% estimated`}><span style={{ width: `${pct}%` }} /></span>
                      </Link>
                      <div className="session-side">
                        <code className="small">{r.id}</code>
                        <button className="link small" onClick={() => {
                          if (!r.hosting || window.confirm(`Delete "${r.name}" from this browser? The room and its history are stored only here.`)) forget(r.id);
                        }} title={r.hosting ? "Delete the room (it is stored only in this browser)" : "Remove from this list"}>{r.hosting ? "delete" : "forget"}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <aside>
          <form className="panel" onSubmit={(e) => { e.preventDefault(); if (blockers.length === 0) create(false); }}>
            <h2>Host a session</h2>
            <label>Your name
              <input value={you} onChange={(e) => setYou(e.target.value)} placeholder="Alex" maxLength={40} />
            </label>
            <label>Jira board
              <BoardPicker value={board} onChange={chooseBoard} search={searchBoards} />
            </label>
            {existingForBoard.length > 0 && (
              <p className="hint small">
                You already host a session for this board:{" "}
                {existingForBoard.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link href={`/room/#${r.id}`}>{r.name}</Link></span>)}
              </p>
            )}
            <label>Session name
              <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder="Sprint 42 refinement" maxLength={80} />
            </label>
            <label>Agreement rule
              <select value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
                <option value="unanimous">Unanimous — everyone on the same card</option>
                <option value="adjacent">Adjacent — within one card step (higher wins)</option>
              </select>
            </label>
            <button className="primary" disabled={blockers.length > 0} title={blockers.join(" ") || undefined}>Create room</button>
            {blockers.length > 0 && <ul className="blockers small">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            {DEMO_ENABLED && (
              <p className="small muted">
                Development:{" "}
                <button type="button" className="link small" onClick={() => create(true)}>create a demo room with fake Jira data</button>
              </p>
            )}
          </form>

          <form className="panel" onSubmit={(e) => { e.preventDefault(); if (parsedCode) router.push(`/room/#${parsedCode}`); }}>
            <h2>Join a session</h2>
            <label>Invite link or room code
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345 or https://…/room/#ABCD2345" />
            </label>
            <button disabled={!parsedCode} title={parsedCode ? undefined : "Enter the 8-character room code or paste the invite link"}>Join</button>
            {!parsedCode && (
              <p className="blockers small">{code.trim() ? "That is not a valid room code — it has 8 letters/digits, e.g. ABCD2345." : "Paste the invite link the host shared, or type its 8-character code."}</p>
            )}
          </form>
        </aside>
      </div>
    </main>
  );
}
