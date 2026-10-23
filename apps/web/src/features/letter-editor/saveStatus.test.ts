import { describe, expect, it } from 'vitest';
import { saveStatusText } from './useAutosave';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

describe('saveStatusText', () => {
  it('reads like Simplify', () => {
    expect(saveStatusText('pending', null, null, NOW)).toBe('Saving…');
    expect(saveStatusText('saving', NOW, null, NOW)).toBe('Saving…');
    expect(saveStatusText('error', NOW, null, NOW)).toBe('Error saving');
    expect(saveStatusText('saved', NOW - 20_000, null, NOW)).toBe('Saved just now');
    expect(saveStatusText('saved', NOW - 5 * 60_000, null, NOW)).toBe('Saved 5 minutes ago');
    expect(saveStatusText('saved', NOW - 60 * 60_000, null, NOW)).toBe('Saved 1 hour ago');
  });

  it('falls back to the document time before the first save', () => {
    expect(saveStatusText('idle', null, '2026-10-20T12:00:00.000Z', NOW)).toBe('Saved 2 days ago');
    expect(saveStatusText('idle', null, null, NOW)).toBe('');
  });
});
