'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Asks before unsaved changes are left behind: closing or reloading the tab gets the browser's own question, and a
 * click on a link in the page (the bar's Documents, the logo) gets "Leave without saving?" first. The App Router has
 * no way to hold a navigation, so links are caught in the capture phase, before Next's Link sees the click.
 */
export function useLeaveGuard(active: boolean): { dialog: ReactNode } {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value to show their prompt.
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('click', onClick, true);
    };
  }, [active]);

  const dialog = (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null);
      }}
      title="Leave without saving?"
      description="The changes you made to this resume will be lost."
      confirmLabel="Leave"
      cancelLabel="Stay"
      tone="destructive"
      onConfirm={() => {
        if (pendingHref) router.push(pendingHref);
      }}
    />
  );
  return { dialog };
}
