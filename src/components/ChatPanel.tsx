"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage } from "@/core/protocol";
import { CHAT_MAX_LENGTH, REACTIONS, type ChatMessage, type RoomView } from "@/core/room";
import { imageFrom, shrinkImage } from "@/ui/image";
import Markdown, { type MentionContext, mentionContext } from "./Markdown";
import ChatComposer from "./ChatComposer";
import { ticketSuggestions } from "@/ui/mentions";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Room chat. Markdown (with a live preview while typing), Jira keys become ticket mentions with a
 * hovercard, and images can be pasted, dropped or picked. Enter sends, Shift+Enter adds a line.
 */
export default function ChatPanel({ view, send, images, isHost }: {
  view: RoomView; send: (m: ClientMessage) => void; images: Record<string, string>; isHost: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const chat = view.chat;
  const ctx = useMemo(() => mentionContext(view, isHost ? send : undefined), [view, send, isHost]);
  const names = useMemo(() => new Map(view.participants.map((p) => [p.id, p.name])), [view.participants]);

  // Stay pinned to the newest message, unless the reader scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length, images]);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, []);

  const attach = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setProblem(null);
    try { setAttachment((await shrinkImage(file)).data); }
    catch (e) { setProblem((e as Error).message); }
    finally { setBusy(false); }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text && !attachment) return;
    send(attachment ? { type: "chat", text, image: attachment } : { type: "chat", text });
    setDraft(""); setAttachment(null); setProblem(null);
    stick.current = true;
  };

  return (
    <section
      className={`panel chat ${dragging ? "dragging" : ""}`}
      aria-label="Chat"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith("image/"))) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void attach(imageFrom(e.dataTransfer.items)); }}
    >
      <ol
        ref={list}
        className="chat-log"
        aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      >
        {chat.length === 0 && <li className="empty muted small">No messages yet. Say hi 👋 — **markdown**, `code`, ticket keys like {view.tickets.find((t) => t.key)?.key ?? "ABC-123"} and pasted images all work.</li>}
        {chat.map((m, i) => (
          <Message
            key={m.id} m={m} prev={chat[i - 1]} mine={m.authorId === view.you} ctx={ctx}
            image={m.imageId ? images[m.imageId] : undefined} onZoom={setZoom}
            you={view.you} names={names} react={(emoji) => send({ type: "react", messageId: m.id, emoji })}
          />
        ))}
      </ol>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {(attachment || busy) && (
          <div className="attachment">
            {busy ? <span className="muted small">Preparing image…</span> : <img src={attachment!} alt="Image to send" />}
            {attachment && <button type="button" className="link" onClick={() => setAttachment(null)} aria-label="Remove image">✕</button>}
          </div>
        )}
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onPasteImage={(f) => void attach(f)}
          placeholder="Message the room… @ to mention a ticket, **bold**, `code`, paste images"
          maxLength={CHAT_MAX_LENGTH}
          suggest={(q) => ticketSuggestions(view.tickets, q, view.currentTicketId)}
        />
        {problem && <div className="small error">{problem}</div>}
        <div className="row small">
          <button type="button" className="link" onClick={() => picker.current?.click()} title="Attach an image (or paste / drop one)" aria-label="Attach an image">🖼️</button>
          <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { void attach(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <span className="muted grow">{draft.length > CHAT_MAX_LENGTH - 80 ? `${CHAT_MAX_LENGTH - draft.length} left` : "Enter to send · Shift+Enter: new line"}</span>
          <button className="primary" disabled={busy || (!draft.trim() && !attachment)}>Send</button>
        </div>
      </form>

      {zoom && (
        <div className="lightbox" role="dialog" aria-label="Image" onClick={() => setZoom(null)} onKeyDown={(e) => e.key === "Escape" && setZoom(null)} tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={zoom} alt="Shared in chat" />
        </div>
      )}
    </section>
  );
}

function Message({ m, prev, mine, ctx, image, onZoom, you, names, react }: {
  m: ChatMessage; prev?: ChatMessage; mine: boolean; ctx: MentionContext; image?: string; onZoom: (src: string) => void;
  you: string; names: Map<string, string>; react: (emoji: string) => void;
}) {
  // Consecutive messages from the same person within a few minutes form one group.
  const grouped = !!prev && prev.authorId === m.authorId && m.at - prev.at < 5 * 60_000;
  const reactions = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length > 0);
  const who = (ids: string[]) => ids.map((id) => (id === you ? "You" : names.get(id) ?? "Someone")).join(", ");
  return (
    <li className={`msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
      {!grouped && (
        <div className="msg-meta small">
          <b>{mine ? "You" : m.name}</b> <span className="muted">{time(m.at)}</span>
        </div>
      )}
      <div className="msg-body">
        <div className="msg-text" title={grouped ? time(m.at) : undefined}>
          {m.imageId && (image
            ? <button type="button" className="msg-image" onClick={() => onZoom(image)} aria-label="Open image"><img src={image} alt={`Image from ${m.name}`} /></button>
            : <div className="msg-image missing small muted">🖼️ Image no longer available</div>)}
          {m.text && <Markdown text={m.text} ctx={ctx} />}
        </div>
        {/* Teams-style: a reaction bar appears on hover / focus. */}
        <div className="react-bar" role="toolbar" aria-label="React">
          {REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => react(e)} aria-label={`React with ${e}`}
              className={m.reactions?.[e]?.includes(you) ? "on" : ""}>{e}</button>
          ))}
        </div>
      </div>
      {reactions.length > 0 && (
        <div className="reactions">
          {reactions.map(([e, ids]) => (
            <button key={e} type="button" className={`reaction ${ids.includes(you) ? "on" : ""}`} onClick={() => react(e)}
              title={`${who(ids)} reacted with ${e}`} aria-label={`${e} ${ids.length}: ${who(ids)}`}>
              {e} <span>{ids.length}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
