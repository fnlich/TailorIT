'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CoverLetterPreviewResponse } from '@tailorit/shared/letters';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';

/**
 * Simplify's "Cover Letter Preview": the letter as it prints, in a frame with every sandbox flag off, scaled to the
 * dialog's width and as tall as the letter (it scrolls inside the dialog).
 */
export function PreviewDialog({
  open,
  onOpenChange,
  title = 'Cover Letter Preview',
  queryKey,
  load,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  queryKey: readonly unknown[];
  load: () => Promise<CoverLetterPreviewResponse>;
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={title} size="xl" className="sm:max-w-[760px]">
          <PreviewBody queryKey={queryKey} load={load} title={title} />
          {footer}
        </DialogContent>
      )}
    </Dialog>
  );
}

function PreviewBody({ queryKey, load, title }: { queryKey: readonly unknown[]; load: () => Promise<CoverLetterPreviewResponse>; title: string }) {
  const query = useQuery({ queryKey: [...queryKey, 'preview'], queryFn: load, staleTime: 0 });
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const page = query.data?.page;

  useEffect(() => {
    const element = box.current;
    if (!element || !page) return;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / page.widthPx));
    observer.observe(element);
    return () => observer.disconnect();
  }, [page]);

  if (query.isError) {
    return (
      <Notice tone="error" className="mt-4">
        {userMessage(query.error, 'The preview could not be drawn. Please try again.')}
      </Notice>
    );
  }
  return (
    <div className="mt-4 max-h-[min(72vh,820px)] overflow-y-auto rounded-[10px] border border-border bg-surface-low p-3">
      <div ref={box} className="relative w-full bg-white shadow-soft" style={{ height: page && scale ? (height ?? page.heightPx) * scale : 480 }}>
        {!query.data || !scale ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={20} label="Drawing the preview..." />
          </div>
        ) : (
          <iframe
            ref={frame}
            title={title}
            srcDoc={query.data.html}
            sandbox="allow-same-origin"
            className="absolute top-0 left-0 origin-top-left border-0 bg-white"
            style={{ width: query.data.page.widthPx, height: height ?? query.data.page.heightPx, transform: `scale(${scale})` }}
            onLoad={() => {
              // Same-origin (no scripts can run: no allow-scripts) so the page's height can be read for the letter's length.
              const doc = frame.current?.contentDocument;
              const full = doc?.documentElement.scrollHeight;
              if (full && page) setHeight(Math.max(page.heightPx, full));
            }}
          />
        )}
      </div>
    </div>
  );
}
