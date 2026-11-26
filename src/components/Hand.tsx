'use client';
import { DECK, type Card } from '@/core/deck';
import { cardLabel } from './cards';

export default function Hand({ selected, disabled, onPick }: { selected: Card | null; disabled: boolean; onPick: (c: Card) => void }) {
  return (
    <div className="hand" role="group" aria-label="Your cards">
      {DECK.map((c) => (
        <button
          key={String(c)}
          className={`poker-card ${selected === c ? 'selected' : ''} ${typeof c === 'string' ? 'special' : ''}`}
          disabled={disabled}
          onClick={() => onPick(c)}
          aria-pressed={selected === c}
          title={c === '?' ? 'Not enough information' : c === 'coffee' ? 'I need a break' : `${c} points`}
        >
          {cardLabel(c)}
        </button>
      ))}
    </div>
  );
}
