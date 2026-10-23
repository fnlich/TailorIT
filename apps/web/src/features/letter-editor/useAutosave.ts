'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Autosave for the letter and template editors (Simplify: 1 second after typing stops). Changes are merged into one
 * pending patch; saves never overlap (a change during a save is sent right after it); a failed save keeps its patch
 * for the next change or flush. Leaving the page with unsaved changes sends them with `keepalive`.
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface Autosave<P extends object> {
  state: SaveState;
  /** When the last save finished (ms), this session. */
  savedAt: number | null;
  /** Adds to the pending patch and restarts the 1 s timer. */
  schedule: (patch: P) => void;
  /** Saves what is pending now (e.g. before an export). Resolves when it is saved; rejects if that fails. */
  flush: () => Promise<void>;
  /** Whether anything is waiting or being saved. */
  hasUnsaved: () => boolean;
}

export const AUTOSAVE_DELAY_MS = 1000;

export function useAutosave<P extends object>(
  save: (patch: P, options: { keepalive: boolean }) => Promise<unknown>,
  delay = AUTOSAVE_DELAY_MS,
): Autosave<P> {
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const pending = useRef<P | null>(null);
  const timer = useRef<number | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(async (): Promise<void> => {
    clearTimer();
    for (;;) {
      // One save at a time: wait for the one in flight, then send what has gathered since.
      while (running.current) await running.current.catch(() => undefined);
      const patch = pending.current;
      if (!patch) return;
      pending.current = null;
      setState('saving');
      const job = (async () => {
        try {
          await saveRef.current(patch, { keepalive: false });
          if (!pending.current) {
            setState('saved');
            setSavedAt(Date.now());
          }
        } catch (error) {
          // Keep it for the next attempt, under anything newer.
          pending.current = { ...patch, ...(pending.current ?? {}) } as P;
          setState('error');
          throw error;
        }
      })();
      running.current = job;
      try {
        await job;
      } finally {
        running.current = null;
      }
      // Changes made during the save go now, unless their own timer is still counting.
      if (!pending.current || timer.current !== null) return;
    }
  }, []);

  const schedule = useCallback(
    (patch: P) => {
      pending.current = { ...(pending.current ?? {}), ...patch } as P;
      setState('pending');
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        run().catch(() => undefined);
      }, delay);
    },
    [delay, run],
  );

  const hasUnsaved = useCallback(() => pending.current !== null || running.current !== null, []);

  // Leaving: send what is pending without waiting for the timer.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current) {
        const patch = pending.current;
        pending.current = null;
        void saveRef.current(patch, { keepalive: true }).catch(() => undefined);
      }
      if (running.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimer();
      if (pending.current) {
        const patch = pending.current;
        pending.current = null;
        void saveRef.current(patch, { keepalive: true }).catch(() => undefined);
      }
    };
  }, []);

  return { state, savedAt, schedule, flush: run, hasUnsaved };
}

/**
 * The editor bar's save line: "Saving…", "Saved just now", "Saved 5 minutes ago", "Error saving". Before anything is
 * saved in this session, the document's own last save (`updatedAt`) is shown.
 */
export function saveStatusText(state: SaveState, savedAt: number | null, updatedAt: string | null, now: number): string {
  if (state === 'pending' || state === 'saving') return 'Saving…';
  if (state === 'error') return 'Error saving';
  const at = savedAt ?? (updatedAt ? Date.parse(updatedAt) : NaN);
  if (!Number.isFinite(at)) return '';
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return 'Saved just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Saved ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Saved ${days} day${days === 1 ? '' : 's'} ago`;
}
