'use client';

import { useCallback, useMemo, useState } from 'react';

export interface Selection {
  /** Selected ids, limited to `ids` (what is on screen and selectable). */
  selected: ReadonlySet<string>;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  isSelected: (id: string) => boolean;
  /** Ticks or unticks one id; with `shiftKey`, everything between the last toggled id and this one follows. */
  toggle: (id: string, checked: boolean, options?: { shiftKey?: boolean }) => void;
  setAll: (checked: boolean) => void;
  clear: () => void;
}

/**
 * Checkbox selection over the ids on screen, in display order. Ids that leave the list (deleted, filtered out by a
 * search) drop out of the selection, so a bulk action only ever touches visible rows.
 */
export function useSelection(ids: readonly string[]): Selection {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const selected = useMemo(() => {
    const visible = new Set(ids);
    return new Set([...raw].filter((id) => visible.has(id)));
  }, [ids, raw]);

  const toggle = useCallback(
    (id: string, checked: boolean, options?: { shiftKey?: boolean }) => {
      setRaw((current) => {
        const next = new Set(current);
        const from = options?.shiftKey && anchor ? ids.indexOf(anchor) : -1;
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (const rangeId of ids.slice(start, end + 1)) {
            if (checked) next.add(rangeId);
            else next.delete(rangeId);
          }
        } else if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
      setAnchor(id);
    },
    [anchor, ids],
  );

  const setAll = useCallback(
    (checked: boolean) => {
      setRaw(checked ? new Set(ids) : new Set());
      setAnchor(null);
    },
    [ids],
  );

  const clear = useCallback(() => {
    setRaw(new Set());
    setAnchor(null);
  }, []);

  const count = selected.size;
  return {
    selected,
    count,
    allSelected: ids.length > 0 && count === ids.length,
    someSelected: count > 0 && count < ids.length,
    isSelected: (id: string) => selected.has(id),
    toggle,
    setAll,
    clear,
  };
}
