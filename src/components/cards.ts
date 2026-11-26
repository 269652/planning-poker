import type { Card } from '@/core/deck';

export const cardLabel = (c: Card | null | undefined) => (c === 'coffee' ? '☕' : c === null || c === undefined ? '' : String(c));

export const TREND_TEXT: Record<string, { label: string; tone: 'good' | 'bad' | 'neutral' }> = {
  none: { label: 'No rounds yet', tone: 'neutral' },
  'first-round': { label: 'First round', tone: 'neutral' },
  converging: { label: 'Converging ↘', tone: 'good' },
  diverging: { label: 'Diverging ↗', tone: 'bad' },
  steady: { label: 'Steady →', tone: 'neutral' },
  agreed: { label: 'Agreed ✓', tone: 'good' },
};
