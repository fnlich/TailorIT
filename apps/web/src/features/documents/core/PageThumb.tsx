'use client';

import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PAGE_A4, type PageSize } from './types';

/**
 * One printed page scaled down to the width of its box. The frame is laid out at the page's own size and scaled
 * with `transform`, never reflowed, so a thumbnail is the page as it prints; only the first page shows (the box
 * clips the rest). `srcDoc` pages are framed with every sandbox flag off: nothing in them runs. The frame is drawn
 * only once the box has been measured, so a full-size frame never flashes; until then `placeholder` stands on the
 * white sheet. It is decorative to assistive tech (the card around it carries the name).
 */
export function PageThumb({
  srcDoc,
  src,
  title,
  page = PAGE_A4,
  placeholder,
  lazy = true,
  className,
}: {
  srcDoc?: string;
  /** A same-origin page URL (e.g. a template gallery preview), framed without a sandbox override. */
  src?: string;
  title: string;
  page?: PageSize;
  placeholder?: ReactNode;
  lazy?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / page.widthPx));
    observer.observe(element);
    return () => observer.disconnect();
  }, [page.widthPx]);

  const hasPage = Boolean(src) || srcDoc !== undefined;
  return (
    <div
      ref={box}
      className={clsx('relative w-full overflow-hidden bg-white', className)}
      style={{ aspectRatio: `${page.widthPx} / ${page.heightPx}` }}
    >
      {hasPage && scale > 0 ? (
        <iframe
          // A new src is a new frame, so changing pages never adds browser-history entries.
          key={src ?? 'srcdoc'}
          src={src}
          srcDoc={srcDoc}
          title={title}
          aria-hidden="true"
          tabIndex={-1}
          scrolling="no"
          loading={lazy ? 'lazy' : 'eager'}
          {...(srcDoc !== undefined ? { sandbox: '' } : {})}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{ width: page.widthPx, height: page.heightPx, transform: `scale(${scale})` }}
        />
      ) : (
        placeholder
      )}
    </div>
  );
}

/** The shimmer on a white page while it is drawn (still under reduced motion). */
export function ThumbLoading() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,#ffffff_20%,#f3f3f3_40%,#ffffff_60%)] bg-[length:300%_100%] motion-reduce:animate-none"
    />
  );
}

/** A sentence on the white page, for a page that could not be drawn ("No preview"). */
export function ThumbState({ children }: { children: ReactNode }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-subtle-foreground">
      {children}
    </span>
  );
}
