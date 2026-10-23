'use client';

import { useCallback, useSyncExternalStore } from 'react';

/*
 * localStorage that never throws (private windows and blocked site data refuse it) plus a hook that reads a key
 * without a hydration mismatch: the server snapshot is the fallback, the browser's value arrives after hydration.
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

const listeners = new Map<string, Set<() => void>>();

export function writeStored(key: string, value: string | null): void {
  try {
    const store = storage();
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // A convenience that just is not remembered.
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribeKey(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * A remembered string setting. `parse` turns the stored text (or null) into a value; anything it rejects should
 * map to the default. Every component reading the same key sees writes at once.
 */
export function useStoredValue<T extends string>(
  key: string,
  parse: (raw: string | null) => T,
): [T, (value: T) => void] {
  const subscribe = useCallback((listener: () => void) => subscribeKey(key, listener), [key]);
  const getSnapshot = useCallback(() => parse(readStored(key)), [key, parse]);
  const getServerSnapshot = useCallback(() => parse(null), [parse]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback((next: T) => writeStored(key, next), [key]);
  return [value, setValue];
}
