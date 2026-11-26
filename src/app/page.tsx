'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { newRoomId } from '@/lib/ids';

export default function Lobby() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    try { setName(localStorage.getItem('pp.name') ?? ''); } catch {}
  }, []);

  const remember = () => { try { localStorage.setItem('pp.name', name.trim()); } catch {} };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    remember();
    const id = newRoomId();
    router.push(`/room/${id}?n=${encodeURIComponent(roomName.trim() || 'Planning session')}`);
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    remember();
    router.push(`/room/${encodeURIComponent(code.trim().replace(/^.*\/room\//, ''))}`);
  };

  return (
    <main className="lobby">
      <h1>🂡 Planning Poker</h1>
      <p className="muted">Estimate real Jira tickets together, in realtime. Rounds repeat until the team agrees, then the estimate is written back.</p>
      <div className="card-panel">
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" maxLength={40} /></label>
      </div>
      <div className="grid2">
        <form className="card-panel" onSubmit={create}>
          <h2>Start a session</h2>
          <label>Session name<input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Sprint 42 refinement" maxLength={80} /></label>
          <button className="primary" disabled={!name.trim()}>Create room</button>
        </form>
        <form className="card-panel" onSubmit={join}>
          <h2>Join a session</h2>
          <label>Room code or link<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="k3x9ab" /></label>
          <button disabled={!name.trim() || !code.trim()}>Join room</button>
        </form>
      </div>
    </main>
  );
}
