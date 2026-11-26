"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Role } from "@/core/room";
import { joinUrlFor } from "@/ui/format";
import { useRoomSocket } from "@/ui/useRoomSocket";
import Board from "./Board";

export default function RoomClient({ roomId }: { roomId: string }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("voter");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("poker:name");
      if (saved) setName(saved);
    } catch { /* ignore */ }
  }, []);

  const sock = useRoomSocket({ roomId, name, role, enabled: joined });

  if (!joined) {
    return (
      <main className="home">
        <h1>Join room {roomId}</h1>
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            try { localStorage.setItem("poker:name", name.trim()); } catch { /* ignore */ }
            setJoined(true);
          }}
        >
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required />
          </label>
          <label className="check">
            <input type="checkbox" checked={role === "observer"} onChange={(e) => setRole(e.target.checked ? "observer" : "voter")} />
            Join as observer (no vote)
          </label>
          <button className="primary" disabled={!name.trim()}>Enter room</button>
        </form>
      </main>
    );
  }

  if (sock.fatal) {
    return (
      <main className="home">
        <h1>Room not found</h1>
        <p className="muted">{sock.fatal} — check the code, or ask the host for a fresh link.</p>
        <Link href="/">Back to start</Link>
      </main>
    );
  }

  if (!sock.view) {
    return <main className="home"><p className="muted">{sock.status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</p></main>;
  }

  return (
    <Board
      view={sock.view}
      status={sock.status}
      token={sock.token}
      error={sock.error}
      dismissError={sock.dismissError}
      send={sock.send}
      shareUrl={joinUrlFor(window.location.origin, roomId)}
    />
  );
}
