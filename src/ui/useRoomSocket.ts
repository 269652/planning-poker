"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/core/protocol";
import type { Role, RoomView } from "@/core/room";
import { wsUrlFor } from "./format";

export type ConnStatus = "connecting" | "open" | "reconnecting";
export interface SocketError { code: string; message: string; id: number }

const tokenKey = (roomId: string) => `poker:token:${roomId}`;

export function readToken(roomId: string): string | undefined {
  try { return localStorage.getItem(tokenKey(roomId)) ?? undefined; } catch { return undefined; }
}

export function useRoomSocket(opts: { roomId: string; name: string; role: Role; enabled: boolean }) {
  const { roomId, name, role, enabled } = opts;
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<SocketError | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>(() => readToken(roomId));
  const wsRef = useRef<WebSocket | null>(null);
  const errId = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(wsUrlFor(window.location));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify({ type: "join", roomId, name, role, token: readToken(roomId) }));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string) as ServerMessage;
        if (m.type === "welcome") {
          try { localStorage.setItem(tokenKey(roomId), m.token); } catch { /* private mode */ }
          setToken(m.token);
          setStatus("open");
        } else if (m.type === "state") setView(m.room);
        else if (m.type === "error") {
          if (m.code === "NOT_FOUND" && !view) { setFatal(m.message); closed = true; ws.close(); return; }
          setError({ code: m.code, message: m.message, id: ++errId.current });
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        setStatus("reconnecting");
        retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 8000));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); clearInterval(ping); wsRef.current?.close(); };
    // `view` intentionally omitted: only the first-join NOT_FOUND check reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name, role, enabled]);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    else setError({ code: "OFFLINE", message: "Not connected — reconnecting…", id: ++errId.current });
  }, []);

  return { view, status, error, fatal, token, send, dismissError: () => setError(null) };
}
