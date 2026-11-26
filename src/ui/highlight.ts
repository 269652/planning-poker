import { INLINE } from "./markdown";

/**
 * Live formatting for the chat composer: the same text, with every character kept (so the caret
 * maps 1:1), wrapped in spans that style it as it will look — bold bold, code monospace, ticket keys
 * as chips — while the Markdown markers stay visible but faint. Returns escaped HTML.
 */
export function highlightHTML(text: string): string {
  let fence = false;
  const lines = text.split("\n").map((line) => {
    if (/^```/.test(line)) { fence = !fence; return span("md-mk md-pre", line); }
    if (fence) return span("md-pre", line);
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3}\s)(.*)$/.exec(line))) return span("md-mk", m[1]) + `<span class="md-h">${inline(m[2])}</span>`;
    if ((m = /^(>\s?)(.*)$/.exec(line))) return span("md-mk", m[1]) + `<span class="md-q">${inline(m[2])}</span>`;
    if ((m = /^(\s*(?:[-*]|\d+[.)])\s)(.*)$/.exec(line))) return span("md-mk", m[1]) + inline(m[2]);
    return inline(line);
  });
  return lines.join("\n");
}

function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(new RegExp(INLINE.source, "g"))) {
    const start = m.index ?? 0;
    out += esc(text.slice(last, start));
    const all = m[0];
    if (m[1] !== undefined) out += span("md-mk", "`") + span("md-code", m[1]) + span("md-mk", "`");
    else if (m[2] !== undefined) out += span("md-mk", "[") + `<span class="md-link">${inline(m[2])}</span>` + span("md-mk", `](${m[3]})`);
    else if (m[4] !== undefined) out += span("md-link", all);
    else if (m[5] !== undefined || m[6] !== undefined) out += wrap(all, 2, "strong");
    else if (m[7] !== undefined) out += wrap(all, 2, "del");
    else if (m[8] !== undefined || m[9] !== undefined) out += wrap(all, 1, "em");
    else if (m[10] !== undefined) out += span("mention", all);
    last = start + all.length;
  }
  return out + esc(text.slice(last));
}

const wrap = (all: string, n: number, tag: string) =>
  span("md-mk", all.slice(0, n)) + `<${tag}>${inline(all.slice(n, -n))}</${tag}>` + span("md-mk", all.slice(-n));
const span = (cls: string, text: string) => `<span class="${cls}">${esc(text)}</span>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
