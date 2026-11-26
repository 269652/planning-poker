"use client";
import { useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView } from "@/core/room";
import type { TicketQueue } from "@/ui/queue";
import { unreadCount } from "@/ui/chat";
import { pulseFrom } from "@/scenes/bus";
import TicketList from "./TicketList";
import ChatPanel from "./ChatPanel";

type Tab = "tickets" | "chat";
const TAB_KEY = "poker:sidetab";

function savedTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === "chat" ? "chat" : "tickets"; } catch { return "tickets"; }
}

/** The left sidebar: tickets and the room chat, as two tabs. */
export default function SideTabs({ view, queue, isHost, send, onImport, images }: {
  view: RoomView; queue: TicketQueue; isHost: boolean; send: (m: ClientMessage) => void; onImport: () => void;
  images: Record<string, string>;
}) {
  const [tab, setTab] = useState<Tab>("tickets");
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const chatTab = useRef<HTMLButtonElement>(null);
  const lastAt = view.chat.at(-1)?.at ?? 0;

  // Restore the last tab; what was already in the chat on arrival counts as read.
  useEffect(() => { setTab(savedTab()); }, []);
  useEffect(() => { if (seenAt === null) setSeenAt(lastAt); }, [seenAt, lastAt]);
  // While the chat is open, everything in it is read.
  useEffect(() => { if (tab === "chat") setSeenAt(lastAt); }, [tab, lastAt]);

  const unread = seenAt === null ? 0 : unreadCount(view.chat, view.you, seenAt);
  // A new message from someone else while on the tickets tab: a small ripple from the chat tab.
  const prevUnread = useRef(0);
  useEffect(() => {
    if (unread > prevUnread.current) pulseFrom(chatTab.current, 0.5, 0.55);
    prevUnread.current = unread;
  }, [unread]);

  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode: not remembered */ }
  };

  return (
    <div className="side-tabs">
      <div className="tabs" role="tablist" aria-label="Sidebar">
        <button role="tab" id="tab-tickets" aria-selected={tab === "tickets"} aria-controls="panel-side" className={tab === "tickets" ? "active" : ""} onClick={() => choose("tickets")}>
          Tickets <span className="count">{queue.upNext.length + (queue.current ? 1 : 0)}</span>
        </button>
        <button ref={chatTab} role="tab" id="tab-chat" aria-selected={tab === "chat"} aria-controls="panel-side" className={tab === "chat" ? "active" : ""} onClick={() => choose("chat")}>
          Chat {unread > 0 && <span className="count unread" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>}
        </button>
      </div>
      <div id="panel-side" role="tabpanel" aria-labelledby={tab === "chat" ? "tab-chat" : "tab-tickets"}>
        {tab === "tickets"
          ? <TicketList view={view} queue={queue} isHost={isHost} send={send} onImport={onImport} />
          : <ChatPanel view={view} send={send} images={images} isHost={isHost} />}
      </div>
    </div>
  );
}
