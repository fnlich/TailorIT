'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { COLUMN_PREFS_STORAGE_KEY, readColumnPrefs, type ColumnPrefs } from '@tailorit/shared';
import { useStoredValue, writeStored } from '@/lib/storage';
import { readTrackerUrl, trackerSearch, type TrackerUrlState } from './state';

/** `value`, once it has stopped changing for `delay` ms (the search box's 500 ms). */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The tracker's URL state. Changes replace the current history entry through the History API, which Next's router
 * follows (no server round trip).
 */
export function useTrackerUrl(): [TrackerUrlState, (next: TrackerUrlState) => void] {
  const params = useSearchParams();
  const state = useMemo(() => readTrackerUrl(params), [params]);
  const setState = useCallback((next: TrackerUrlState) => {
    const search = trackerSearch(next, new URLSearchParams(window.location.search));
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, []);
  return [state, setState];
}

const identity = (raw: string | null) => raw ?? '';

/** Board column visibility (forced / default / hidden), remembered in localStorage like Simplify's `columnStatus`. */
export function useColumnPrefs(): [ColumnPrefs, (next: ColumnPrefs) => void] {
  const [raw] = useStoredValue<string>(COLUMN_PREFS_STORAGE_KEY, identity);
  const prefs = useMemo(() => readColumnPrefs(raw), [raw]);
  const setPrefs = useCallback((next: ColumnPrefs) => writeStored(COLUMN_PREFS_STORAGE_KEY, JSON.stringify(next)), []);
  return [prefs, setPrefs];
}

const ARCHIVED_COLUMN_KEY = 'tailorit.tracker.archivedColumn';
const asFlag = (raw: string | null) => (raw === '1' ? '1' : '');

/** Whether the board shows the Archived column (off by default, remembered per browser). */
export function useArchivedColumn(): [boolean, (shown: boolean) => void] {
  const [raw] = useStoredValue<string>(ARCHIVED_COLUMN_KEY, asFlag);
  const set = useCallback((shown: boolean) => writeStored(ARCHIVED_COLUMN_KEY, shown ? '1' : null), []);
  return [raw === '1', set];
}

/**
 * A mouse press held for `delay` ms without moving opens the card's menu (touch long-press is the context menu's own).
 * `consumeClick` tells the click that ends a long press not to open the application.
 */
export function useLongPress(onLongPress: () => void, delay = 500) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const handlers = useMemo(
    () => ({
      onPointerDown(event: PointerEvent) {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        fired.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        clear();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          fired.current = true;
          onLongPress();
        }, delay);
      },
      onPointerMove(event: PointerEvent) {
        if (timer.current === null || !origin.current) return;
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 6) clear();
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    }),
    [clear, delay, onLongPress],
  );

  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return { handlers, consumeClick, cancel: clear };
}
