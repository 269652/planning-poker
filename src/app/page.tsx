"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rule, setRule] = useState<"unanimous" | "adjacent">("unanimous");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jira, setJira] = useState<{ configured: boolean; kind: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/jira/status").then((r) => r.json()).then(setJira).catch(() => setJira(null));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, rule }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create room");
      router.push(`/room/${(await res.json()).id}`);
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const id = code.trim().toUpperCase();
    if (id) router.push(`/room/${id}`);
  }

  return (
    <main className="home">
      <h1>Planning Poker</h1>
      <p className="muted">Estimate real Jira tickets together, in realtime. Rounds repeat until the team agrees, then the estimate is written back.</p>

      <form className="panel" onSubmit={create}>
        <h2>Start a session</h2>
        <label>Session name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 42 refinement" maxLength={80} required />
        </label>
        <label>Agreement rule
          <select value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
            <option value="unanimous">Unanimous — everyone on the same card</option>
            <option value="adjacent">Adjacent — within one card step (higher wins)</option>
          </select>
        </label>
        <button className="primary" disabled={busy || !name.trim()}>Create room</button>
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          Jira: {jira === null ? "…" : jira.configured ? (jira.kind === "mock" ? "demo data (mock)" : "connected") : "not configured — you can still add tickets manually"}
        </p>
      </form>

      <form className="panel" onSubmit={join}>
        <h2>Join a session</h2>
        <label>Room code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" maxLength={8} />
        </label>
        <button disabled={!code.trim()}>Join</button>
      </form>
    </main>
  );
}
