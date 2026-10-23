import type { PageSize } from './types';

/*
 * Thumbnails are asked for once per version of a document, not once per card drawn: switching tabs or between
 * Grid and List unmounts every card. The last 48 pages are kept here (module state, so they survive navigation but
 * not a reload), keyed `kind:id:updatedAt` (a save is a new key), and a request in flight is shared by every card
 * that asks for the same page.
 */

export interface ThumbPage {
  /** The page's HTML, framed with `srcdoc` in a sandbox with every flag off. */
  html: string;
  /** The page box the HTML was laid out for (defaults to the card's). */
  page?: PageSize;
}

export const THUMB_CACHE_SIZE = 48;

const pages = new Map<string, ThumbPage>();
const requests = new Map<string, Promise<ThumbPage>>();

/** A kept page. Reading changes nothing; only `touchThumb` (from an effect) refreshes its place. */
export function cachedThumb(key: string): ThumbPage | undefined {
  return pages.get(key);
}

/** A page just shown becomes the newest, so the pages on screen are the last to be evicted. */
export function touchThumb(key: string): void {
  const page = pages.get(key);
  if (page === undefined) return;
  pages.delete(key);
  pages.set(key, page);
}

export function rememberThumb(key: string, page: ThumbPage): void {
  pages.delete(key);
  pages.set(key, page);
  while (pages.size > THUMB_CACHE_SIZE) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined) break;
    pages.delete(oldest);
  }
}

/** Drops kept pages whose key starts with `prefix` (e.g. "resume:abc:" after a delete), or all of them. */
export function forgetThumbs(prefix?: string): void {
  for (const key of [...pages.keys()]) {
    if (!prefix || key.startsWith(prefix)) pages.delete(key);
  }
}

/** Fetches a page once per key; concurrent callers share the request. Failures are not cached. */
export function loadThumb(key: string, fetchPage: () => Promise<ThumbPage | string>): Promise<ThumbPage> {
  const kept = pages.get(key);
  if (kept) return Promise.resolve(kept);
  const pending = requests.get(key);
  if (pending) return pending;
  const request = fetchPage()
    .then((answer) => {
      const page = typeof answer === 'string' ? { html: answer } : answer;
      rememberThumb(key, page);
      return page;
    })
    .finally(() => {
      requests.delete(key);
    });
  requests.set(key, request);
  return request;
}
