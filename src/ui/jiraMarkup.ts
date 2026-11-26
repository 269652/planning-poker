/**
 * A small, safe subset of Jira wiki markup (what REST v2 returns on Server/DC), plus common
 * Markdown, parsed into plain data. The UI renders these as React text nodes — never as HTML —
 * and only http(s) URLs become links, so issue content cannot inject script.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: { header: boolean; cells: string[] }[] };

const SAFE_URL = /^https?:\/\/[^\s]+$/i;

const INLINE = new RegExp(
  [
    String.raw`\{\{(.+?)\}\}`, // 1 {{code}}
    String.raw`\*\*([^*\n]+)\*\*`, // 2 **md bold**
    String.raw`(?<![\w*])\*([^*\n]+?)\*(?![\w*])`, // 3 *bold*
    String.raw`(?<!\w)_([^_\n]+?)_(?!\w)`, // 4 _italic_
    String.raw`\[([^\]|\n]+)\|([^\]\n]+)\]`, // 5,6 [text|url]
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`, // 7,8 [text](url)
    String.raw`\[(https?:\/\/[^\]\s]+)\]`, // 9 [url]
    String.raw`(https?:\/\/[^\s<>\]|]+)`, // 10 bare url
  ].join("|"),
  "g",
);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += s;
    else out.push({ kind: "text", text: s });
  };
  const link = (label: string, href: string) => {
    if (SAFE_URL.test(href.trim())) out.push({ kind: "link", text: label, href: href.trim() });
    else pushText(label);
  };
  let pos = 0;
  for (const m of text.matchAll(INLINE)) {
    pushText(text.slice(pos, m.index));
    pos = m.index! + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "strong", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "strong", text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: "em", text: m[4] });
    else if (m[5] !== undefined) link(m[5], m[6]);
    else if (m[7] !== undefined) link(m[7], m[8]);
    else if (m[9] !== undefined) link(m[9], m[9]);
    else if (m[10] !== undefined) link(m[10], m[10]);
  }
  pushText(text.slice(pos));
  return out;
}

const CODE_OPEN = /^\s*(\{code(?::[^}]*)?\}|\{noformat\}|```\w*)(.*)$/;
const CODE_CLOSE: Record<string, RegExp> = { code: /\{code\}/, noformat: /\{noformat\}/, fence: /```/ };

export function parseJiraMarkup(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ kind: "paragraph", text: para.join("\n") }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const open = trimmed.match(CODE_OPEN);
    if (open) {
      flush();
      const kind = open[1].startsWith("```") ? "fence" : open[1].startsWith("{noformat") ? "noformat" : "code";
      const close = CODE_CLOSE[kind];
      const body: string[] = [];
      let rest = open[2];
      for (;;) {
        const c = rest.match(close);
        if (c) { body.push(rest.slice(0, c.index)); break; }
        body.push(rest);
        if (++i >= lines.length) break;
        rest = lines[i];
      }
      blocks.push({ kind: "code", text: body.join("\n").replace(/^\n+|\n+$/g, "") });
      continue;
    }

    if (!trimmed) { flush(); continue; }

    const h = trimmed.match(/^h([1-6])\.\s+(.*)$/) ?? trimmed.match(/^(#{2,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].startsWith("#") ? h[1].length : Number(h[1]), text: h[2] });
      continue;
    }

    const q = trimmed.match(/^(?:bq\.|>)\s?(.*)$/);
    if (q) { flush(); blocks.push({ kind: "quote", text: q[1] }); continue; }

    if (trimmed.startsWith("|")) {
      flush();
      const rows: { header: boolean; cells: string[] }[] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const row = lines[i].trim();
        const header = row.startsWith("||");
        const cells = row.split(header ? "||" : "|").slice(1);
        if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
        rows.push({ header, cells: cells.map((c) => c.trim()) });
      }
      i--;
      blocks.push({ kind: "table", rows });
      continue;
    }

    const li = trimmed.match(/^([*-]+|#|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = li[1] === "#" || /\d/.test(li[1]);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered && isListLine(lines[i - 1])) last.items.push(li[2]);
      else blocks.push({ kind: "list", ordered, items: [li[2]] });
      continue;
    }

    para.push(trimmed);
  }
  flush();
  return blocks;
}

function isListLine(line: string | undefined): boolean {
  return !!line && /^\s*([*-]+|#|\d+\.)\s+/.test(line);
}
