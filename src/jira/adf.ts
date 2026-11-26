/**
 * Minimal Atlassian Document Format (ADF) <-> plain text conversion.
 * Jira Cloud (REST v3) returns/accepts descriptions and comments as ADF; Server
 * and Data Center (REST v2) use plain strings. We only need a readable preview
 * of descriptions and a simple paragraph-based comment body.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

const INLINE = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date']);

export function adfToText(doc: unknown): string {
  if (doc === null || doc === undefined) return '';
  if (typeof doc === 'string') return doc;
  return render(doc as Node).trim();
}

function render(n: Node): string {
  switch (n.type) {
    case 'text':
      return n.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(n.attrs?.text ?? '@user');
    case 'emoji':
      return String(n.attrs?.shortName ?? n.attrs?.text ?? '');
    case 'inlineCard':
      return String(n.attrs?.url ?? '');
    case 'bulletList':
      return (n.content ?? []).map((li) => `- ${render(li)}`).join('\n');
    case 'orderedList':
      return (n.content ?? []).map((li, i) => `${i + 1}. ${render(li)}`).join('\n');
    case 'listItem':
      return blocks(n.content ?? [], '\n');
    default: {
      const kids = n.content ?? [];
      return kids.every((k) => k.type && INLINE.has(k.type))
        ? kids.map(render).join('')
        : blocks(kids, '\n\n');
    }
  }
}

function blocks(kids: Node[], sep: string): string {
  return kids.map(render).filter((s) => s !== '').join(sep);
}

/** Build an ADF document: blank-line separated paragraphs, single newlines become hard breaks. */
export function textToAdf(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim() !== '');
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: p.split('\n').flatMap((line, i) => [
        ...(i > 0 ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]),
    })),
  };
}
