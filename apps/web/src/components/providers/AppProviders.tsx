'use client';

import type { ReactNode } from 'react';
import { IconContext } from '@/components/ui/icons';
import { ToastProvider } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { QueryProvider } from '@/lib/query';

/** Phosphor defaults for the whole app: 16 px, regular weight, decorative. */
const ICON_DEFAULTS = {
  color: 'currentColor',
  size: 16,
  weight: 'regular',
  mirrored: false,
  'aria-hidden': true,
} as const;

/** Client-side context every page needs: React Query, tooltips' shared delay, toasts and icon defaults. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <IconContext.Provider value={ICON_DEFAULTS}>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </IconContext.Provider>
    </QueryProvider>
  );
}
