import { clsx } from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Logo, LogoMark } from '@/components/shell/Logo';

export const metadata: Metadata = { title: 'Page not found' };

/*
 * Any address TailorIT has no page for (the sign-in gate has already let the person through): the header's white bar
 * with the logo, and a card in the empty-state style that says so, with the way back to Jobs. A Server Component, so
 * it stays plain markup (the kit's Button module is a client one; the link carries the primary button's look).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="h-[63px] shrink-0 border-b border-border bg-surface">
        <div className={clsx('flex h-full items-center', PAGE_GUTTER)}>
          <Link href="/jobs" aria-label="TailorIT, go to Jobs" className="flex items-center rounded-control outline-offset-4">
            <Logo className="max-sm:hidden" />
            <LogoMark className="sm:hidden" />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-16 sm:py-24">
        <div className="flex w-full max-w-lg flex-col items-center gap-1.5 rounded-surface border border-border bg-surface px-6 py-14 text-center shadow-soft">
          <span
            aria-hidden="true"
            className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-primary-ink"
          >
            404
          </span>
          <h1 className="text-lg leading-7 font-semibold text-foreground">Page not found</h1>
          <p className="max-w-md text-sm leading-5 text-muted-foreground">
            The address may be mistyped, or the page has moved. Your jobs, applications and documents are all still here.
          </p>
          <Link
            href="/jobs"
            className="mt-4 inline-flex h-9 items-center justify-center rounded-control bg-primary px-4 text-sm font-semibold whitespace-nowrap text-white transition-colors duration-150 hover:bg-primary-500"
          >
            Go to Jobs
          </Link>
        </div>
      </main>
    </div>
  );
}
