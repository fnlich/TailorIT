'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Whether a media query matches, kept in step with the window (the server snapshot is `serverValue`). */
export function useMediaQuery(query: string, serverValue = true): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The editor's two columns fit from this width up (the form and the preview side by side). */
export const WIDE_EDITOR_QUERY = '(min-width: 1100px)';
