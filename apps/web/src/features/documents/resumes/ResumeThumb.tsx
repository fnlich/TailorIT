'use client';

import type { ResumeSummary } from '@tailorit/shared/resume';
import { useEffect, useRef, useState } from 'react';
import { DocumentThumb, PageThumb, ThumbLoading, ThumbState, thumbKey, type ThumbPage } from '../core';
import { fetchThumbnail } from '../../resume-editor/api';

/*
 * A resume's first page, fetched once it is near the screen and kept per version (the documents layer's cache, keyed
 * `resume:id:updatedAt`): a built resume's page is HTML drawn by the server (framed with every sandbox flag off), an
 * upload's is the PNG made when it was stored.
 */

async function loadBuiltPage(id: string): Promise<ThumbPage> {
  const answer = await fetchThumbnail(id, 'built');
  if (answer.kind !== 'html') throw new Error('No preview');
  return { html: answer.html, page: answer.page ?? undefined };
}

/** Upload image addresses already worked out (module state: survives tab and view switches, not a reload). */
const imageUrls = new Map<string, string>();
const imageRequests = new Map<string, Promise<string>>();

function resolveImage(key: string, id: string): Promise<string> {
  const kept = imageUrls.get(key);
  if (kept) return Promise.resolve(kept);
  const pending = imageRequests.get(key);
  if (pending) return pending;
  const request = fetchThumbnail(id, 'uploaded')
    .then((answer) => {
      if (answer.kind !== 'image') throw new Error('No preview');
      imageUrls.set(key, answer.url);
      return answer.url;
    })
    .finally(() => imageRequests.delete(key));
  imageRequests.set(key, request);
  return request;
}

export function ResumeThumb({
  resume,
  title,
}: {
  resume: Pick<ResumeSummary, 'id' | 'kind' | 'updatedAt'>;
  /** For the frame or image; the card carries the name a reader hears. */
  title: string;
}) {
  if (resume.kind === 'uploaded') return <UploadThumb id={resume.id} updatedAt={resume.updatedAt} title={title} />;
  return <DocumentThumb cacheKey={thumbKey('resume', resume.id, resume.updatedAt)} load={() => loadBuiltPage(resume.id)} title={title} />;
}

function UploadThumb({ id, updatedAt, title }: { id: string; updatedAt: string; title: string }) {
  const key = `${thumbKey('resume', id, updatedAt)}:image`;
  const box = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const kept = imageUrls.get(key);
  const src = kept ?? (resolved?.key === key ? resolved.url : undefined);

  useEffect(() => {
    if (kept) return;
    const element = box.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        resolveImage(key, id).then(
          (url) => {
            if (!cancelled) setResolved({ key, url });
          },
          () => {
            if (!cancelled) setFailedKey(key);
          },
        );
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [key, id, kept]);

  if (src) return <DocumentThumb cacheKey={key} imageSrc={src} title={title} />;
  return (
    <div ref={box}>
      <PageThumb title={title} placeholder={failedKey === key ? <ThumbState>No preview</ThumbState> : <ThumbLoading />} />
    </div>
  );
}
