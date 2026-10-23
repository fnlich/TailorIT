import type { DocumentKind } from './types';

/*
 * Where focus goes when a document leaves the page (deleted, bulk-deleted): the next one, else the one before, else
 * the grid's New tile, else the page's own "new" button. Without this the focused card unmounts, focus falls to
 * the document, and a keyboard user starts again from the top.
 */

/** The id to focus once `removed` have gone from `order` (ids as displayed): next after the first removed, else the last before it. */
export function neighbourOf(order: readonly string[], removed: readonly string[]): string | null {
  const gone = new Set(removed);
  const at = order.findIndex((id) => gone.has(id));
  if (at < 0) return null;
  for (let index = at + 1; index < order.length; index += 1) {
    const id = order[index];
    if (id !== undefined && !gone.has(id)) return id;
  }
  for (let index = at - 1; index >= 0; index -= 1) {
    const id = order[index];
    if (id !== undefined && !gone.has(id)) return id;
  }
  return null;
}

/**
 * Focuses the card or row of `id` (its main link, else its checkbox/menu), else `[data-new-tile=kind]`, else
 * `[data-new-fallback=kind]`. Call it after the list has re-rendered: it waits two animation frames.
 */
export function focusDocument(kind: DocumentKind, id: string | null): void {
  if (typeof window === 'undefined') return;
  const frame = window.requestAnimationFrame.bind(window);
  frame(() =>
    frame(() => {
      const escaped = id === null ? null : CSS.escape(id);
      const container =
        escaped !== null
          ? document.querySelector<HTMLElement>(`[data-${kind}-card="${escaped}"], [data-${kind}-row="${escaped}"]`)
          : null;
      const target =
        container?.querySelector<HTMLElement>('a[href], button, [role="checkbox"]') ??
        document.querySelector<HTMLElement>(`[data-new-tile="${kind}"]`) ??
        document.querySelector<HTMLElement>(`[data-new-fallback="${kind}"]`);
      target?.focus();
    }),
  );
}
