"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Role } from "@/core/room";
import { parseRoomCode } from "@/core/roomId";
import { joinUrlFor } from "@/ui/format";
import { siteUrl } from "@/ui/site";
import { LocalStore } from "@/ui/storage";
import { useRoom } from "@/ui/useRoom";
import Board from "./Board";

export default function RoomClient() {
  const [roomId, setRoomId] = useState<string | null | undefined>(undefined);
  const [hosting, setHosting] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("voter");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const read = () => {
      const id = parseRoomCode(window.location.hash);
      const store = LocalStore.browser();
      const host = !!id && store.isHosting(id);
      setRoomId(id);
      setHosting(host);
      const saved = store.getName();
      setName(saved);
      // The host, and guests who were here before, go straight in.
      setJoined(!!id && !!saved && (host || !!store.getToken(id)));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const conn = useRoom({ roomId: roomId ?? "", name, role, enabled: joined && !!roomId, hosting });

  if (roomId === undefined) return <main className="home"><p className="muted">Loading…</p></main>;
  if (roomId === null) {
    return (
      <main className="home">
        <h1>No room in this link</h1>
        <p className="muted">Invite links look like <code>…/room/#ABCD2345</code>. Ask the host for the link, or enter the code on the start page.</p>
        <Link href="/">Back to start</Link>
      </main>
    );
  }

  if (!joined) {
    return (
      <main className="home">
        <h1>Join room {roomId}</h1>
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            LocalStore.browser().setName(name);
            setJoined(true);
          }}
        >
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          </label>
          <label className="check">
            <input type="checkbox" checked={role === "observer"} onChange={(e) => setRole(e.target.checked ? "observer" : "voter")} />
            Join as observer (no vote)
          </label>
          <button className="primary" disabled={!name.trim()} title={name.trim() ? undefined : "Enter your name first"}>Enter room</button>
          {!name.trim() && <p className="blockers small">Enter your name to join.</p>}
        </form>
      </main>
    );
  }

  if (conn.fatal) {
    return (
      <main className="home">
        <h1>Room unavailable</h1>
        <p className="muted">{conn.fatal}.</p>
        <Link href="/">Back to start</Link>
      </main>
    );
  }

  if (!conn.view) {
    return (
      <main className="home">
        <div className="panel center">
          {conn.status === "host-offline" ? (
            <>
              <h2>Waiting for the host…</h2>
              <p className="muted">Room <b>{roomId}</b> runs in the host&apos;s browser. It opens as soon as the host has the room open — this page keeps trying.</p>
            </>
          ) : (
            <p className="muted">{conn.status === "reconnecting" ? "Reconnecting to the host…" : "Connecting to the host…"}</p>
          )}
          <Link href="/" className="small">Back to start</Link>
        </div>
      </main>
    );
  }

  return (
    <Board
      view={conn.view}
      status={conn.status}
      error={conn.error}
      dismissError={conn.dismissError}
      send={conn.send}
      shareUrl={joinUrlFor(siteUrl(), roomId)}
      hosting={hosting}
      hostPeer={conn.hostPeer}
      helper={conn.helper}
      jira={conn.jira}
      retryHelper={conn.retryHelper}
      nudged={conn.nudged}
      images={conn.images}
      streams={conn.streams}
      presence={conn.presence}
    />
  );
}
