import { APPLICATION_STATUSES, STATUS_INFO, isApplicationStatus, type ApplicationStatus } from './statuses';

// Board column visibility (Simplify's `columnStatus`, kept in localStorage): a column is forced (always shown),
// default (shown only while it has cards) or hidden. Hiding a column sets `hidden`; ticking it in "Visible columns", or
// moving a card into it, sets `forced`.

export const COLUMN_MODES = ['forced', 'default', 'hidden'] as const;
export type ColumnMode = (typeof COLUMN_MODES)[number];
export type ColumnPrefs = Partial<Record<ApplicationStatus, ColumnMode>>;

/** localStorage key of the column preferences. */
export const COLUMN_PREFS_STORAGE_KEY = 'tailorit.tracker.columnStatus';
/** Cards per column page ("Load more applications"). */
export const BOARD_PAGE_SIZE = 25;

/** A column's mode: the stored preference, else the status's default. */
export function columnMode(prefs: ColumnPrefs | null | undefined, status: ApplicationStatus): ColumnMode {
  return prefs?.[status] ?? STATUS_INFO[status].column;
}

/**
 * The columns the board shows, in status order: forced ones always, default ones while they hold a card. `counts`
 * is keyed by status (a number or its string).
 */
export function visibleColumns(
  prefs: ColumnPrefs | null | undefined,
  counts: Readonly<Partial<Record<number | string, number>>>,
): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter((status) => {
    const mode = columnMode(prefs, status);
    if (mode === 'forced') return true;
    if (mode === 'hidden') return false;
    return (counts[status] ?? counts[String(status)] ?? 0) > 0;
  });
}

/** The eye-slash "Hide column". */
export function hideColumn(prefs: ColumnPrefs | null | undefined, status: ApplicationStatus): ColumnPrefs {
  return { ...prefs, [status]: 'hidden' };
}

/** Ticking a column in Visible columns, or moving a card into it. */
export function showColumn(prefs: ColumnPrefs | null | undefined, status: ApplicationStatus): ColumnPrefs {
  return { ...prefs, [status]: 'forced' };
}

/** Stored preferences read back safely: anything that is not a known status with a known mode is dropped. */
export function readColumnPrefs(value: unknown): ColumnPrefs {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const prefs: ColumnPrefs = {};
  for (const [key, mode] of Object.entries(source as Record<string, unknown>)) {
    const status = Number(key);
    if (isApplicationStatus(status) && (COLUMN_MODES as readonly unknown[]).includes(mode)) {
      prefs[status] = mode as ColumnMode;
    }
  }
  return prefs;
}
