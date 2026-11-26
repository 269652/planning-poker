'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '@/core/room';
import type { RoomView } from '@/core/view';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting';
export type ClientAction = Exclude<Action, { type: 'join' | 'disconnect' | 'importTickets' | 'jiraWriteStart' | 'jiraWriteResult' }>;

interface JiraResult { reqId: string; ok: boolean; data?: any; error?: string }

/** Secret identity for this browser; the server only ever exposes a hash of it. */
function clientKey(): string {
  try {
    let k = localStorage.getItem('pp.clientKey');
    if (!k || k.length < 16) {
      k = crypto.randomUUID() + crypto.randomUUID();
      localStorage.setItem('pp.clientKey', k);
    }
    return k;
  } catch {
    return crypto.randomUUID() + crypto.randomUUID();
  }
}

export function useRoom(roomId: string, name: string | null, roomName?: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, (r: JiraResult) => void>());

  useEffect(() => {
    if (!name) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const key = clientKey();

    const connect = () => {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        attempt = 0;
        setStatus('open');
        sock.send(JSON.stringify({ type: 'join', roomId, roomName, clientKey: key, name }));
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'state') setView(m.view);
        else if (m.type === 'error') {
          setError(m.message);
          setTimeout(() => setError((cur) => (cur === m.message ? null : cur)), 5000);
        } else if (m.type === 'jiraResult') {
          pending.current.get(m.reqId)?.(m);
          pending.current.delete(m.reqId);
        }
      };
      sock.onclose = () => {
        if (closed) return;
        setStatus('reconnecting');
        retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 8000));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [roomId, name, roomName]);

  const act = useCallback((action: ClientAction) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'action', action }));
  }, []);

  const jira = useCallback(<T = any>(op: Record<string, unknown> & { op: string }): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
      const reqId = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pending.current.delete(reqId);
        reject(new Error('Jira request timed out'));
      }, 30_000);
      pending.current.set(reqId, (r) => {
        clearTimeout(timer);
        r.ok ? resolve(r.data) : reject(new Error(r.error ?? 'Jira request failed'));
      });
      ws.current.send(JSON.stringify({ type: 'jira', reqId, ...op }));
    });
  }, []);

  return { view, status, error, act, jira };
}
