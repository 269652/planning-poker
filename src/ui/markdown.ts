/**
 * A small, safe Markdown dialect for chat. It produces a tree of known node types (never raw HTML),
 * so nothing a participant types can inject markup or scripts.
 *
 * Blocks: paragraphs, ``` code blocks ```, > quotes, - / * / 1. lists, # headings.
 * Inline: `code`, **bold**, *italic* / _italic_, ~~strike~~, [text](https://…), bare https:// links,
 * and Jira issue keys (BMG-123), which the chat renders as ticket mentions.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b" | "i" | "s"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "ticket"; key: string }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "pre"; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "ul" | "ol"; items: Inline[][] };

export const ISSUE_KEY = /\b[A-Z][A-Z0-9_]{1,9}-\d{1,7}\b/;

export const INLINE = new RegExp(
  [
    /`([^`\n]+)`/.source,                                   // 1 code
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.source,       // 2 text, 3 href
    /(https?:\/\/[^\s<>"'`]+)/.source,                       // 4 bare URL
    /\*\*([^\n]+?)\*\*|__([^\n]+?)__/.source,               // 5, 6 bold
    /~~([^\n]+?)~~/.source,                                 // 7 strike
    /\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w])/.source,   // 8, 9 italic
    `(${ISSUE_KEY.source})`,                                // 10 issue key
  ].join("|"),
  "g",
);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v; else out.push({ t: "text", v });
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    pushText(text.slice(last, start));
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "link", href: m[3], c: parseInline(m[2]) });
    else if (m[4] !== undefined) {
      // Trailing punctuation belongs to the sentence, not the link.
      const trail = /[.,;:!?)\]]+$/.exec(m[4])?.[0] ?? "";
      const href = m[4].slice(0, m[4].length - trail.length);
      out.push({ t: "link", href, c: [{ t: "text", v: href }] });
      pushText(trail);
    } else if (m[5] !== undefined || m[6] !== undefined) out.push({ t: "b", c: parseInline(m[5] ?? m[6]) });
    else if (m[7] !== undefined) out.push({ t: "s", c: parseInline(m[7]) });
    else if (m[8] !== undefined || m[9] !== undefined) out.push({ t: "i", c: parseInline(m[8] ?? m[9]) });
    else if (m[10] !== undefined) out.push({ t: "ticket", key: m[10] });
    last = start + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

/** Inline content of several lines: lines joined with explicit breaks. */
function lines(ls: string[]): Inline[] {
  const out: Inline[] = [];
  ls.forEach((l, i) => { if (i) out.push({ t: "br" }); out.push(...parseInline(l)); });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const ls = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < ls.length) {
    const l = ls[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^```/.test(l)) {
      const body: string[] = [];
      i++;
      while (i < ls.length && !/^```/.test(ls[i])) body.push(ls[i++]);
      i++; // closing fence (or end of text)
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, c: parseInline(h[2]) }); i++; continue; }
    if (/^>\s?/.test(l)) {
      const body: string[] = [];
      while (i < ls.length && /^>\s?/.test(ls[i])) body.push(ls[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(body.join("\n")) });
      continue;
    }
    const listKind = /^\s*[-*]\s+/.test(l) ? "ul" : /^\s*\d+[.)]\s+/.test(l) ? "ol" : null;
    if (listKind) {
      const item = listKind === "ul" ? /^\s*[-*]\s+/ : /^\s*\d+[.)]\s+/;
      const items: Inline[][] = [];
      while (i < ls.length && item.test(ls[i])) items.push(parseInline(ls[i++].replace(item, "")));
      blocks.push({ t: listKind, items });
      continue;
    }
    const para: string[] = [];
    while (i < ls.length && !/^\s*$/.test(ls[i]) && !/^(```|#{1,3}\s|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(ls[i])) para.push(ls[i++]);
    if (para.length === 0) para.push(ls[i++]); // a line that only looked like a block start
    blocks.push({ t: "p", c: lines(para) });
  }
  return blocks;
}

/** Does the text use any formatting worth previewing? */
export function hasMarkup(text: string): boolean {
  return /[`*_~\[>#]|^\s*(\d+[.)]|[-*])\s/m.test(text) || ISSUE_KEY.test(text) || /https?:\/\//.test(text);
}

/** Issue keys mentioned in a text (in order, without duplicates). */
export function mentionedKeys(text: string): string[] {
  return [...new Set([...text.matchAll(new RegExp(ISSUE_KEY.source, "g"))].map((m) => m[0]))];
}
