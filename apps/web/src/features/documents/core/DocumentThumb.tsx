'use client';

import { useEffect, useRef, useState } from 'react';
import { PageThumb, ThumbLoading, ThumbState } from './PageThumb';
import { cachedThumb, loadThumb, touchThumb, type ThumbPage } from './thumbCache';
import { PAGE_A4, type PageSize } from './types';

export interface DocumentThumbProps {
  /** thumbKey(kind, id, updatedAt): a save is a new key and a fresh render. */
  cacheKey: string;
  /** Fetches the first page's HTML (or `{ html, page }`). Called once the card is within `rootMargin` of view. */
  load?: () => Promise<ThumbPage | string>;
  /** Or a ready image of the first page (uploaded PDFs' PNG thumbnails). */
  imageSrc?: string;
  /** For the frame/img; the card carries the name a reader hears. */
  title: string;
  page?: PageSize;
  rootMargin?: string;
  className?: string;
}

/**
 * A document's first page, fetched lazily (IntersectionObserver, 300 px margin) through the module-level LRU in
 * thumbCache, with a shimmer while it loads and "No preview" when it cannot be drawn (no retry until the key
 * changes or the card remounts).
 */
export function DocumentThumb({
  cacheKey,
  load,
  imageSrc,
  title,
  page = PAGE_A4,
  rootMargin = '300px',
  className,
}: DocumentThumbProps) {
  const box = useRef<HTMLDivElement>(null);
  const latestLoad = useRef(load);
  const [loaded, setLoaded] = useState<{ key: string; page: ThumbPage } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const kept = imageSrc ? undefined : cachedThumb(cacheKey);
  const thumb = kept ?? (loaded?.key === cacheKey ? loaded.page : undefined);
  const isKept = kept !== undefined;
  const failed = failedKey === cacheKey;

  useEffect(() => {
    latestLoad.current = load;
  }, [load]);

  useEffect(() => {
    if (imageSrc) return;
    if (isKept) {
      touchThumb(cacheKey);
      return;
    }
    const element = box.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const fetchPage = latestLoad.current;
        if (!fetchPage) {
          setFailedKey(cacheKey);
          return;
        }
        loadThumb(cacheKey, fetchPage).then(
          (result) => {
            if (!cancelled) setLoaded({ key: cacheKey, page: result });
          },
          () => {
            if (!cancelled) setFailedKey(cacheKey);
          },
        );
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, isKept, imageSrc, rootMargin]);

  if (imageSrc) {
    return (
      <div ref={box} className={className}>
        <PageThumb
          title={title}
          page={page}
          placeholder={
            failed ? (
              <ThumbState>No preview</ThumbState>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image; next/image adds nothing here
              <img
                src={imageSrc}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setFailedKey(cacheKey)}
                className="absolute inset-0 size-full object-cover object-top"
              />
            )
          }
        />
      </div>
    );
  }

  return (
    <div ref={box} className={className}>
      <PageThumb
        srcDoc={thumb?.html}
        title={title}
        page={thumb?.page ?? page}
        placeholder={failed ? <ThumbState>No preview</ThumbState> : <ThumbLoading />}
      />
    </div>
  );
}
