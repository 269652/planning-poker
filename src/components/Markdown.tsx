"use client";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ClientMessage } from "@/core/protocol";
import type { RoomView, TicketView } from "@/core/room";
import { type Block, type Inline, parseMarkdown } from "@/ui/markdown";
import { cardLabel } from "@/ui/format";

/** What ticket mentions need to know: the room's tickets, a Jira link base, and whether you may import. */
export interface MentionContext {
  tickets: Map<string, TicketView>;
  currentTicketId: string | null;
  jiraBase: string | null;
  /** Set for the host: offers "Add to session" for tickets that aren't in the room yet. */
  importKey?: (key: string) => void;
}

export function mentionContext(view: RoomView, send?: (m: ClientMessage) => void): MentionContext {
  const tickets = new Map(view.tickets.filter((t) => t.key).map((t) => [t.key!.toUpperCase(), t]));
  // Jira links look like …/browse/KEY-1: any imported ticket tells us the base.
  const withUrl = view.tickets.find((t) => t.url && /\/browse\/[^/]+$/.test(t.url));
  const jiraBase = withUrl ? withUrl.url!.replace(/\/browse\/[^/]+$/, "") : null;
  const isHost = view.hostId === view.you;
  return {
    tickets, currentTicketId: view.currentTicketId, jiraBase,
    importKey: isHost && send ? (key) => send({ type: "importJira", issueKeys: [key] }) : undefined,
  };
}

export default function Markdown({ text, ctx }: { text: string; ctx: MentionContext }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks.map((b, i) => <BlockView key={i} b={b} ctx={ctx} />)}</div>;
}

function BlockView({ b, ctx }: { b: Block; ctx: MentionContext }) {
  switch (b.t) {
    case "p": return <p>{inlines(b.c, ctx)}</p>;
    case "h": return <p className={`md-h md-h${b.level}`}>{inlines(b.c, ctx)}</p>;
    case "pre": return <pre><code>{b.v}</code></pre>;
    case "quote": return <blockquote>{b.c.map((x, i) => <BlockView key={i} b={x} ctx={ctx} />)}</blockquote>;
    case "ul": return <ul>{b.items.map((it, i) => <li key={i}>{inlines(it, ctx)}</li>)}</ul>;
    case "ol": return <ol>{b.items.map((it, i) => <li key={i}>{inlines(it, ctx)}</li>)}</ol>;
  }
}

function inlines(ns: Inline[], ctx: MentionContext): ReactNode {
  return ns.map((n, i) => <Fragment key={i}>{inline(n, ctx)}</Fragment>);
}

function inline(n: Inline, ctx: MentionContext): ReactNode {
  switch (n.t) {
    case "text": return n.v;
    case "br": return <br />;
    case "code": return <code>{n.v}</code>;
    case "b": return <strong>{inlines(n.c, ctx)}</strong>;
    case "i": return <em>{inlines(n.c, ctx)}</em>;
    case "s": return <del>{inlines(n.c, ctx)}</del>;
    case "link": return <a href={n.href} target="_blank" rel="noopener noreferrer">{inlines(n.c, ctx)}</a>;
    case "ticket": return <TicketMention issueKey={n.key} ctx={ctx} />;
  }
}

function sessionState(t: TicketView, currentId: string | null): string {
  if (t.id === currentId) return "Now estimating";
  if (t.status === "estimated") return `Estimated: ${cardLabel(t.estimate)} SP`;
  return t.currentEstimate !== null ? `Up next · was ${t.currentEstimate} SP` : "Up next";
}

/** An issue key as an inline chip; hovering or focusing it shows a preview card. */
function TicketMention({ issueKey, ctx }: { issueKey: string; ctx: MentionContext }) {
  const ticket = ctx.tickets.get(issueKey.toUpperCase());
  const href = ticket?.url ?? (ctx.jiraBase ? `${ctx.jiraBase}/browse/${issueKey}` : undefined);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchor = useRef<HTMLElement>(null);

  const open = () => {
    clearTimeout(hide.current);
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 190 > window.innerHeight;
    // The card is 21rem wide (scales with the root size), at most the screen width minus a margin.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const w = Math.min(21 * rem, window.innerWidth - 16);
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = () => { clearTimeout(hide.current); hide.current = setTimeout(() => setPos(null), 150); };
  const props = {
    ref: anchor as never, className: `mention ${ticket ? "known" : ""}`,
    onMouseEnter: open, onMouseLeave: close, onFocus: open, onBlur: close,
  };

  return (
    <>
      {href
        ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{issueKey}</a>
        : <span {...props} tabIndex={0}>{issueKey}</span>}
      {pos && createPortal(
        <div
          className={`hovercard ${pos.above ? "above" : ""}`}
          style={{ left: pos.x, top: pos.y }}
          onMouseEnter={open}
          onMouseLeave={close}
          role="tooltip"
        >
          <div className="hc-head small">
            <b>{issueKey}</b>
            {ticket?.issueType && <span className="muted">{ticket.issueType}</span>}
            {ticket?.jiraStatus && <span className="hc-status">{ticket.jiraStatus}</span>}
          </div>
          {ticket ? (
            <>
              <div className="hc-title">{ticket.title}</div>
              {ticket.description && <div className="hc-desc small muted">{ticket.description.replace(/[{}*_#|[\]]/g, "").slice(0, 220)}{ticket.description.length > 220 ? "…" : ""}</div>}
              <div className="hc-foot small"><span className={`hc-state ${ticket.status}`}>{sessionState(ticket, ctx.currentTicketId)}</span>{href && <span className="muted">Open in Jira ↗</span>}</div>
            </>
          ) : (
            <>
              <div className="small muted">Not in this session.</div>
              <div className="hc-foot small">
                {ctx.importKey && <button className="link" onClick={() => { ctx.importKey!(issueKey); setPos(null); }}>Add to session</button>}
                {href && <span className="muted">Open in Jira ↗</span>}
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
