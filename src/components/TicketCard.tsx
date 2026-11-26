"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TicketView } from "@/core/room";
import { trendLabel } from "@/ui/format";
import { parseInline, parseJiraMarkup, type Block } from "@/ui/jiraMarkup";

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((n, i) => {
        switch (n.kind) {
          case "strong": return <strong key={i}>{n.text}</strong>;
          case "em": return <em key={i}>{n.text}</em>;
          case "code": return <code key={i}>{n.text}</code>;
          case "link": return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">{n.text}</a>;
          default: return <span key={i}>{n.text}</span>;
        }
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case "heading": return <h4 className={`md-h md-h${Math.min(b.level, 4)}`}><InlineText text={b.text} /></h4>;
    case "paragraph": return <p>{b.text.split("\n").map((l, i) => <span key={i}>{i > 0 && <br />}<InlineText text={l} /></span>)}</p>;
    case "list": {
      const items = b.items.map((it, i) => <li key={i}><InlineText text={it} /></li>);
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code": return <pre><code>{b.text}</code></pre>;
    case "quote": return <blockquote><InlineText text={b.text} /></blockquote>;
    case "table":
      return (
        <div className="md-table">
          <table>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>{r.cells.map((c, j) => (r.header ? <th key={j}><InlineText text={c} /></th> : <td key={j}><InlineText text={c} /></td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

const TYPE_TONE: Record<string, string> = { bug: "bug", story: "story", task: "task", "sub-task": "task", subtask: "task", epic: "epic", spike: "spike" };

/** The ticket under estimation, styled like a Jira issue so the whole team reads the same thing. */
export default function TicketCard({ ticket, roundNumber }: { ticket: TicketView; roundNumber: number }) {
  const blocks = useMemo(() => parseJiraMarkup(ticket.description ?? ""), [ticket.description]);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const trend = trendLabel(ticket.convergence.trend);
  const type = ticket.issueType ?? (ticket.source === "manual" ? "Manual" : "Issue");
  const tone = TYPE_TONE[type.toLowerCase()] ?? "other";

  useEffect(() => { setExpanded(false); }, [ticket.id]);
  useEffect(() => {
    const el = body.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [blocks, expanded]);

  return (
    <article className="panel issue" aria-label={`Current ticket ${ticket.key ?? ticket.title}`}>
      <div className="issue-meta">
        <span className={`issue-type ${tone}`} title={type}>{type}</span>
        {ticket.key && (ticket.url
          ? <a className="issue-key" href={ticket.url} target="_blank" rel="noreferrer noopener" title="Open in Jira">{ticket.key} ↗</a>
          : <span className="issue-key">{ticket.key}</span>)}
        {ticket.jiraStatus && <span className="issue-status">{ticket.jiraStatus}</span>}
        <span className="grow" />
        <span className={`chip ${trend.tone}`}>{trend.text}</span>
        <span className="chip">Round {roundNumber}</span>
      </div>
      <h2 className="issue-title">{ticket.title}</h2>
      <div className="issue-facts small">
        <span>Story points in Jira: <b>{ticket.currentEstimate ?? "none"}</b></span>
        {ticket.status === "estimated" && <span>Estimated here: <b className="good">{ticket.estimate}</b></span>}
      </div>
      {blocks.length > 0 ? (
        <>
          <div ref={body} className={`issue-body md ${expanded ? "expanded" : ""}`}>
            {blocks.map((b, i) => <BlockView key={i} b={b} />)}
          </div>
          {(overflows || expanded) && (
            <button className="link small" onClick={() => setExpanded((e) => !e)}>{expanded ? "Show less" : "Show full description"}</button>
          )}
        </>
      ) : (
        <p className="muted small">No description.</p>
      )}
    </article>
  );
}
