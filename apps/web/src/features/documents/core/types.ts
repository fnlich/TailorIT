import type { ReactNode } from 'react';

/** What a collection holds. It names the data attributes (`data-resume-card`, `data-cover-letter-row`…). */
export type DocumentKind = 'resume' | 'cover-letter' | 'template';

export type ViewMode = 'grid' | 'list';

/** "resume" / "resumes", "cover letter" / "cover letters": used in status lines, empty states, dialogs. */
export interface Noun {
  one: string;
  many: string;
}

/** One action in a document's ⋮ / "More ⌄" menu. */
export interface ActionMenuItem {
  key: string;
  label: string;
  /** A second line under the label. */
  hint?: string;
  icon?: ReactNode;
  tone?: 'danger';
  disabled?: boolean;
  /** Why it is disabled (tooltip). */
  title?: string;
  /** A separator above it (Delete). */
  ruleBefore?: boolean;
  /** Runs after the menu has closed and focus is back on its trigger, so a dialog it opens returns focus there. */
  onSelect: () => void;
}

/** A column of the list view. The first column is the main one (name + badges). */
export interface DocumentColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS grid track: "minmax(0,1.2fr)", "10rem"… */
  track: string;
  cell: (item: T) => ReactNode;
  align?: 'start' | 'end';
  /** Dropped below 640 px. */
  hideOnMobile?: boolean;
  className?: string;
}

/** A printed page, in CSS px at 96 dpi. */
export interface PageSize {
  widthPx: number;
  heightPx: number;
}

/** A4 (resumes: every reused template prints A4). */
export const PAGE_A4: PageSize = { widthPx: 794, heightPx: 1123 };
/** US Letter (cover letters). */
export const PAGE_LETTER: PageSize = { widthPx: 816, heightPx: 1056 };
