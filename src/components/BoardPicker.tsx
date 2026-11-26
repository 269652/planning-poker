"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { JiraBoard } from "@/jira/types";

/** Autocomplete over Jira boards; `search` asks Jira (through the host's helper) by name. */
export default function BoardPicker({ value, onChange, search, autoFocus, placeholder = "Search Jira boards…" }: {
  value: JiraBoard | null;
  onChange: (b: JiraBoard | null) => void;
  search: ((query: string) => Promise<JiraBoard[]>) | null;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JiraBoard[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const seq = useRef(0);

  // Follow the selected board; clearing the selection while typing must not wipe the typed text.
  useEffect(() => { if (value) setText(value.name); }, [value]);

  useEffect(() => {
    if (!open || !search) return;
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const boards = await search(value && text === value.name ? "" : text);
        if (mine !== seq.current) return; // a newer keystroke won
        setItems(boards); setActive(0); setError(null);
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text, open, value, search]);

  const pick = (b: JiraBoard) => { onChange(b); setText(b.name); setOpen(false); };

  return (
    <div className="combo">
      <div className="combo-input">
        <input
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${items[active].id}` : undefined}
          value={text} placeholder={search ? placeholder : "Needs the Jira helper"} autoFocus={autoFocus} disabled={!search}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setText(value?.name ?? ""); }, 120)}
          onChange={(e) => { setText(e.target.value); setOpen(true); if (value) onChange(null); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && open && items[active]) { e.preventDefault(); pick(items[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {value && <button type="button" className="link combo-clear" aria-label="Clear board" onClick={() => { onChange(null); setText(""); }}>×</button>}
      </div>
      {open && search && (
        <ul className="combo-list" id={listId} role="listbox">
          {error && <li className="error small">{error}</li>}
          {!error && loading && items.length === 0 && <li className="muted small">Searching…</li>}
          {!error && !loading && items.length === 0 && <li className="muted small">No boards match “{text}”.</li>}
          {items.map((b, i) => (
            <li
              key={b.id} id={`${listId}-${b.id}`} role="option" aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => { e.preventDefault(); pick(b); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="grow">{b.name}</span>
              <span className="badge">{b.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
