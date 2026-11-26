"use client";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { highlightHTML } from "@/ui/highlight";
import { activeMention, type TicketSuggestion } from "@/ui/mentions";

export interface ComposerHandle { clear(): void; focus(): void }

/**
 * A chat input that formats Markdown inline as you type (no separate preview): the text is kept
 * character for character and only re-wrapped in styled spans, so the caret can be restored exactly.
 * Enter submits, Shift+Enter adds a line; pasted content arrives as plain text (images go to onPasteImage).
 */
const ChatComposer = forwardRef<ComposerHandle, {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onPasteImage: (file: File) => void;
  placeholder: string;
  maxLength: number;
  /** Tickets for the "@" picker, matching what was typed after "@". */
  suggest: (query: string) => TicketSuggestion[];
}>(function ChatComposer({ value, onChange, onSubmit, onPasteImage, placeholder, maxLength, suggest }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  // "@" picker: the query being typed and the highlighted suggestion.
  const [mention, setMention] = useState<{ start: number; caret: number; items: TicketSuggestion[]; index: number } | null>(null);

  const updateMention = (text: string, caret: number) => {
    const m = activeMention(text, caret);
    const items = m ? suggest(m.query) : [];
    setMention(m && items.length ? { start: m.start, caret, items, index: 0 } : null);
  };

  const pick = (s: TicketSuggestion) => {
    const node = el.current;
    if (!node || !mention) return;
    const text = textOf(node);
    const insert = `${s.key} `;
    const next = (text.slice(0, mention.start) + insert + text.slice(mention.caret)).slice(0, maxLength);
    render(node, next, mention.start + insert.length);
    setMention(null);
    onChange(next);
  };

  useImperativeHandle(ref, () => ({
    clear: () => { if (el.current) el.current.innerHTML = ""; },
    focus: () => el.current?.focus(),
  }));

  // Keep the DOM in step when the value changes from outside (e.g. cleared after sending).
  useLayoutEffect(() => {
    const node = el.current;
    if (node && textOf(node) !== value) render(node, value, value.length);
  }, [value]);

  const sync = () => {
    const node = el.current;
    if (!node || composing.current) return;
    let text = textOf(node);
    if (text.length > maxLength) text = text.slice(0, maxLength);
    const caret = caretOffset(node);
    render(node, text, caret);
    onChange(text);
    updateMention(text, caret);
  };

  return (
    <div className="composer-wrap">
    {mention && (
      <ul className="mention-picker" role="listbox" aria-label="Mention a ticket">
        {mention.items.map((s, i) => (
          <li
            key={s.key} role="option" aria-selected={i === mention.index} className={i === mention.index ? "active" : ""}
            onMouseDown={(e) => { e.preventDefault(); pick(s); }}
            onMouseEnter={() => setMention({ ...mention, index: i })}
          >
            <span className="mention known">{s.key}</span>
            <span className="grow mp-title">{s.title}</span>
            <span className="muted small">{s.hint}</span>
          </li>
        ))}
      </ul>
    )}
    <div
      ref={el}
      className="composer"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Chat message"
      aria-autocomplete="list"
      aria-expanded={!!mention}
      data-placeholder={placeholder}
      spellCheck
      onInput={sync}
      onBlur={() => setMention(null)}
      onKeyUp={(e) => {
        // Moving the caret with arrows/clicks can enter or leave an "@query".
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && el.current) updateMention(textOf(el.current), caretOffset(el.current));
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; sync(); }}
      onKeyDown={(e) => {
        if (mention) {
          const n = mention.items.length;
          if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, index: (mention.index + 1) % n }); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setMention({ ...mention, index: (mention.index - 1 + n) % n }); return; }
          if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pick(mention.items[mention.index]); return; }
          if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
        }
        if (e.key !== "Enter" || composing.current || e.nativeEvent.isComposing) return;
        e.preventDefault();
        if (e.shiftKey) { insertText("\n"); sync(); } else onSubmit();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const item = Array.from(e.clipboardData.items).find((i) => i.kind === "file" && i.type.startsWith("image/"));
        const file = item?.getAsFile();
        if (file) { onPasteImage(file); return; }
        insertText(e.clipboardData.getData("text/plain"));
        sync();
      }}
      onDrop={(e) => { if (e.dataTransfer.files.length) e.preventDefault(); }}
    />
    </div>
  );
});
export default ChatComposer;

/** The plain text: text nodes only (the trailing <br> that shows a final empty line isn't text). */
function textOf(node: HTMLElement): string {
  return node.textContent ?? "";
}

function render(node: HTMLElement, text: string, caret: number) {
  // A trailing newline needs something after it to show the empty line.
  node.innerHTML = highlightHTML(text) + (text.endsWith("\n") ? "<br>" : "");
  if (document.activeElement === node) setCaret(node, Math.min(caret, text.length));
}

function caretOffset(node: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !node.contains(sel.focusNode)) return textOf(node).length;
  const r = document.createRange();
  r.selectNodeContents(node);
  r.setEnd(sel.focusNode!, sel.focusOffset);
  return r.toString().length;
}

function setCaret(node: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let left = offset;
  let t: Node | null;
  const sel = window.getSelection();
  const r = document.createRange();
  while ((t = walker.nextNode())) {
    const len = t.textContent?.length ?? 0;
    if (left <= len) { r.setStart(t, left); r.collapse(true); sel?.removeAllRanges(); sel?.addRange(r); return; }
    left -= len;
  }
  r.selectNodeContents(node); r.collapse(false); sel?.removeAllRanges(); sel?.addRange(r);
}

function insertText(text: string) {
  // execCommand keeps the browser's undo history; fall back to a manual insert.
  if (document.execCommand?.("insertText", false, text)) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const n = document.createTextNode(text);
  r.insertNode(n);
  r.setStartAfter(n); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}
