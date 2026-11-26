import { describe, expect, it } from 'vitest';
import { adfToText, textToAdf } from '@/jira/adf';

describe('adfToText', () => {
  it('returns strings untouched and null as empty', () => {
    expect(adfToText('plain')).toBe('plain');
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
  });

  it('flattens paragraphs, headings, marks and breaks', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Do ', marks: [{ type: 'strong' }] }, { type: 'text', text: 'it' }, { type: 'hardBreak' }, { type: 'text', text: 'now' }] },
      ],
    };
    expect(adfToText(doc)).toBe('Goal\n\nDo it\nnow');
  });

  it('renders lists, mentions, and unknown nodes gracefully', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ] },
        { type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@ann' } }, { type: 'emoji', attrs: { shortName: ':x:' } }] },
        { type: 'mystery', content: [{ type: 'text', text: 'kept' }] },
      ],
    };
    expect(adfToText(doc)).toBe('- one\n- two\n\n@ann:x:\n\nkept');
  });
});

describe('textToAdf', () => {
  it('splits paragraphs and preserves single line breaks', () => {
    expect(textToAdf('a\nb\n\nc')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'c' }] },
      ],
    });
  });

  it('round-trips through adfToText', () => {
    expect(adfToText(textToAdf('x\ny\n\nz'))).toBe('x\ny\n\nz');
  });
});
