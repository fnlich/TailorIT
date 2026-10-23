import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THUMB_CACHE_SIZE, cachedThumb, forgetThumbs, loadThumb, touchThumb } from './thumbCache';

beforeEach(() => forgetThumbs());

describe('thumbCache', () => {
  it('fetches a page once and shares the request in flight', async () => {
    const fetchPage = vi.fn(async () => '<p>page</p>');
    const [a, b] = await Promise.all([loadThumb('resume:1:t', fetchPage), loadThumb('resume:1:t', fetchPage)]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ html: '<p>page</p>' });
    expect(b).toBe(a);
    await loadThumb('resume:1:t', fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not keep failures', async () => {
    const fetchPage = vi.fn(async () => Promise.reject(new Error('render failed')));
    await expect(loadThumb('cover-letter:1:t', fetchPage)).rejects.toThrow('render failed');
    expect(cachedThumb('cover-letter:1:t')).toBeUndefined();
    await expect(loadThumb('cover-letter:1:t', fetchPage)).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used page beyond the limit', async () => {
    for (let index = 0; index < THUMB_CACHE_SIZE; index += 1) {
      await loadThumb(`resume:${index}:t`, async () => `page ${index}`);
    }
    touchThumb('resume:0:t');
    await loadThumb('resume:new:t', async () => 'new page');
    expect(cachedThumb('resume:0:t')).toBeDefined();
    expect(cachedThumb('resume:1:t')).toBeUndefined();
    expect(cachedThumb('resume:new:t')).toEqual({ html: 'new page' });
  });

  it('forgets by prefix', async () => {
    await loadThumb('resume:a:1', async () => 'a');
    await loadThumb('cover-letter:a:1', async () => 'b');
    forgetThumbs('resume:');
    expect(cachedThumb('resume:a:1')).toBeUndefined();
    expect(cachedThumb('cover-letter:a:1')).toBeDefined();
  });
});
