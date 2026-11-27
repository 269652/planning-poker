"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/core/protocol";
import type { Role, RoomView } from "@/core/room";
import { HostEngine, type PeerLink } from "@/host/engine";
import { DEFAULT_HELPER_URL, gatewayForHelper, probeHelper, type HelperStatus } from "@/jira/helper";
import { MockJira } from "@/jira/mock";
import { RelayJiraGateway } from "@/jira/relayGateway";
import type { JiraGateway } from "@/jira/types";
import { hostRoom, joinRoom, type HostState } from "@/net/relay";
import { relayUrl } from "./site";
import { StreamStore } from "./streamStore";
import { PresenceStore } from "./presence";
import { LocalStore } from "./storage";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "host-offline";
export interface SocketError { code: string; message: string; id: number }

export function helperUrl(): string {
  try { return localStorage.getItem("poker:helperUrl") || DEFAULT_HELPER_URL; } catch { return DEFAULT_HELPER_URL; }
}

/**
 * Connects this tab to a room. The host's tab runs the room itself (HostEngine) and opens it to
 * guests through the WebSocket relay; guests connect to the host the same way. Both get the same view/send interface.
 */
export function useRoom(opts: { roomId: string; name: string; role: Role; enabled: boolean; hosting: boolean }) {
  const { roomId, name, role, enabled, hosting } = opts;
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<SocketError | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>();
  const [hostPeer, setHostPeer] = useState<HostState>("registering");
  const [helper, setHelper] = useState<HelperStatus>({ state: "checking" });
  const [jira, setJira] = useState<JiraGateway | null>(null);
  /** The latest ping ("someone is waiting for your vote"); id changes with every ping. */
  const [nudged, setNudged] = useState<{ from: string; id: number } | null>(null);
  /** Chat images received so far (id → data URL). */
  const [images, setImages] = useState<Record<string, string>>({});
  /** What a host/PM is streaming from their import dialog (one store per hook instance). */
  const [streams] = useState(() => new StreamStore());
  /** Everyone's mouse in the room. */
  const [presence] = useState(() => new PresenceStore());
  const sendRef = useRef<(m: ClientMessage) => void>(() => {});
  const probeRef = useRef<() => void>(() => {});
  const errId = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const RELAY_URL = relayUrl();
    if (!RELAY_URL) { setFatal("This site has no relay configured (NEXT_PUBLIC_RELAY_URL)"); return; }
    const store = LocalStore.browser();
    let gotView = false;
    // A guest who is made PM gets Jira through the host (see RelayJiraGateway).
    let relayJira: RelayJiraGateway | null = null;
    let isPm = false;
    const deliver = (m: ServerMessage) => {
      if (relayJira?.receive(m)) return;
      if (streams.receive(m)) return;
      if (presence.receive(m)) return;
      if (m.type === "welcome") { store.setToken(roomId, m.token); setToken(m.token); }
      else if (m.type === "state") {
        gotView = true;
        setView(m.room);
        const pm = !hosting && !!m.room.participants.find((p) => p.id === m.room.you)?.isModerator;
        if (pm !== isPm && relayJira) {
          isPm = pm;
          if (!pm) relayJira.dispose("You are no longer a PM");
          setJira(pm ? relayJira : null);
          if (pm) setHelper({ state: "connected", user: "via the host", jiraUrl: "", storyPointsField: null });
        }
        if (!hosting) {
          store.rememberJoined({
            id: m.room.id, name: m.room.name, board: m.room.board, seenAt: Date.now(),
            ticketCount: m.room.tickets.length, estimatedCount: m.room.tickets.filter((t) => t.status === "estimated").length,
          });
        }
      } else if (m.type === "nudged") {
        setNudged({ from: m.from, id: ++errId.current });
      } else if (m.type === "image") {
        setImages((imgs) => (imgs[m.id] === m.data ? imgs : { ...imgs, [m.id]: m.data }));
      } else if (m.type === "error") {
        if (m.code === "NOT_FOUND" && !gotView) { setFatal(m.message); return; }
        setError({ code: m.code, message: m.message, id: ++errId.current });
      }
    };
    const join = (): ClientMessage => ({ type: "join", roomId, name, role, token: store.getToken(roomId) });

    if (hosting) {
      const room = store.loadHostedRoom(roomId);
      if (!room) { setFatal("This room's data is no longer stored in this browser"); return; }
      const demo = store.isDemo(roomId);
      const mock = demo ? new MockJira() : null;
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      // Only the newest tab hosting this room saves it; an older tab would write back a stale copy.
      const claim = store.claimHosting(roomId);
      const save = () => {
        clearTimeout(saveTimer); saveTimer = undefined;
        if (store.ownsHosting(roomId, claim)) store.saveHostedRoom(room.snapshot());
      };
      const engine = new HostEngine({
        room, jira: mock,
        onChange: () => { saveTimer ??= setTimeout(save, 300); },
      });
      if (mock) { setJira(mock); setHelper({ state: "connected", user: "demo data", jiraUrl: "https://jira.example.test", storyPointsField: null }); }

      // Jira goes through the helper on the host's machine; keep checking it.
      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      let alive = true;
      const probe = async () => {
        clearTimeout(probeTimer);
        const url = helperUrl();
        const s = await probeHelper(url);
        if (!alive) return;
        setHelper(s);
        const g = s.state === "connected" ? gatewayForHelper(url, s) : null;
        engine.setJira(g);
        setJira(g);
        probeTimer = setTimeout(probe, s.state === "connected" ? 60_000 : 10_000);
      };
      if (!demo) { probeRef.current = () => void probe(); void probe(); }

      // The host's own tab is a participant like everyone else, over an in-memory link.
      let link: PeerLink | null = engine.connect((m) => queueMicrotask(() => deliver(m)));
      sendRef.current = (m) => { void link?.receive(JSON.stringify(m)); };
      void link.receive(JSON.stringify(join()));
      setStatus("open");
      const stopPeer = hostRoom(engine, { url: RELAY_URL, hostKey: store.hostKey(roomId) }, (s) => setHostPeer(s));
      const onHide = () => save();
      window.addEventListener("pagehide", onHide);
      // Guests that went silent (closed tab, lost network) leave the room.
      const sweeper = setInterval(() => engine.sweep(), 5_000);
      return () => {
        alive = false;
        clearInterval(sweeper);
        clearTimeout(probeTimer);
        window.removeEventListener("pagehide", onHide);
        stopPeer();
        link?.close(); link = null;
        engine.dispose();
        save();
        sendRef.current = () => {};
      };
    }

    const guest = joinRoom(roomId, {
      // The first ping tells the host this client sends heartbeats (so its silence will mean "gone").
      onOpen: () => { guest.send(join()); guest.send({ type: "ping" }); },
      onMessage: deliver,
      onState: (s) => setStatus(s === "open" ? "open" : s === "host-offline" ? "host-offline" : s === "connecting" ? "connecting" : "reconnecting"),
    }, RELAY_URL);
    sendRef.current = (m) => {
      if (!guest.send(m)) setError({ code: "OFFLINE", message: "Not connected to the host — reconnecting…", id: ++errId.current });
    };
    relayJira = new RelayJiraGateway((m) => guest.send(m));
    // Presence: a heartbeat to the host, and an explicit goodbye when the tab closes. (A reload
    // also says goodbye; the page joins again right after, with its token and its vote.)
    const heartbeat = setInterval(() => guest.send({ type: "ping" }), 15_000);
    const bye = () => { guest.send({ type: "leave" }); };
    const back = (e: PageTransitionEvent) => { if (e.persisted) guest.send({ type: "ping" }); };
    window.addEventListener("pagehide", bye);
    window.addEventListener("pageshow", back);
    return () => {
      clearInterval(heartbeat);
      relayJira?.dispose(); setJira(null); streams.clear();
      window.removeEventListener("pagehide", bye);
      window.removeEventListener("pageshow", back);
      guest.stop(); sendRef.current = () => {};
    };
  }, [roomId, name, role, enabled, hosting, streams, presence]);

  const send = useCallback((m: ClientMessage) => sendRef.current(m), []);
  const dismissError = useCallback(() => setError(null), []);
  const retryHelper = useCallback(() => { setHelper({ state: "checking" }); probeRef.current(); }, []);

  return { view, status, error, fatal, token, send, dismissError, hostPeer, helper, jira, retryHelper, nudged, images, streams, presence };
}
