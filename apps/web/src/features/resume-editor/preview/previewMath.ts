/*
 * The live preview's arithmetic, kept free of React and the DOM so it can be tested.
 *
 * The page is laid out at its printed width and scaled to the pane. The width it scales to must not depend on whether
 * a scrollbar is showing: a one-page resume just taller than the pane would bring the scrollbar in, be scaled down a
 * little, fit, lose the scrollbar, grow back and overflow again, every frame (free_tailor's "preview vibration"). So
 * the width is worked out as if the scrollbar that matters were always there, and the strips only ever grow.
 */

/** What the preview reads off its scroll well and the window, in CSS px. */
export interface WellBox {
  /** The well's border-box width (the same with or without its scrollbar). */
  outerWidth: number;
  /** The well's clientWidth: its padding box less any scrollbar of its own. */
  clientWidth: number;
  borderX: number;
  paddingX: number;
  /** Whether the well scrolls itself (wide layout); otherwise the window does (narrow layout). */
  scrolls: boolean;
  /** The strip the window's scrollbar takes right now: innerWidth less the root element's box width. */
  windowBar: number;
}

/** The widest scrollbar strips seen so far, kept between reads. */
export interface Gutters {
  well: number;
  window: number;
}

export const NO_GUTTERS: Gutters = { well: 0, window: 0 };

/** Below this a difference is rounding between two measures, not a scrollbar. */
const ROUNDING_SLACK_PX = 2;
const strip = (width: number) => (width >= ROUNDING_SLACK_PX ? width : 0);

/** The width to scale the page to, and the strips it allowed for. */
export function stablePaneWidth(box: WellBox, known: Gutters = NO_GUTTERS): { width: number; gutters: Gutters } {
  const inside = box.outerWidth - box.borderX - box.paddingX;
  if (box.scrolls) {
    const well = Math.max(known.well, strip(box.outerWidth - box.borderX - box.clientWidth));
    return { width: Math.max(0, inside - well), gutters: { ...known, well } };
  }
  const windowBar = strip(box.windowBar);
  const windowGutter = Math.max(known.window, windowBar);
  return { width: Math.max(0, inside - (windowGutter - windowBar)), gutters: { ...known, window: windowGutter } };
}

/** The page's scale in the pane: never above 1 (a narrow page is not blown up). 0 until the pane is measured. */
export function previewScale(paneWidth: number, pageWidth: number): number {
  if (!(paneWidth > 0) || !(pageWidth > 0)) return 0;
  return Math.min(1, paneWidth / pageWidth);
}

/** A loaded document's height and its page margins (the preview chrome pads `html` with them). */
export interface Measured {
  height: number;
  padTop: number;
  padBottom: number;
}

/**
 * Where the printed pages would break, in document px: every `contentHeightPx` after the top margin. Approximate on
 * purpose (print repeats the margins on every page; a continuous document does not), which is what the dashed
 * "Page 2" line says. A document no taller than one sheet has no break, whatever the arithmetic says.
 */
export function pageBreaks(
  measured: Measured | null,
  page: { heightPx: number; contentHeightPx: number } | null | undefined,
  maxBreaks = 20,
): number[] {
  if (!measured || !page || !(page.contentHeightPx >= 100)) return [];
  if (measured.height <= page.heightPx + 2) return [];
  const breaks: number[] = [];
  const end = measured.height - measured.padBottom;
  for (let y = measured.padTop + page.contentHeightPx; y < end - 8 && breaks.length < maxBreaks; y += page.contentHeightPx) {
    breaks.push(y);
  }
  return breaks;
}

export type PreviewStatus = 'waiting' | 'updating' | 'current' | 'error';

/**
 * The status line: an error wins; nothing shown yet is "waiting"; current only once the newest answer is the page on
 * screen and it answers the draft as it is now.
 */
export function previewStatus(input: {
  failed: boolean;
  shown: boolean;
  requestKey: string;
  renderedKey: string | null;
  frontId: number | null;
  newestId: number;
}): PreviewStatus {
  if (input.failed) return 'error';
  if (!input.shown) return 'waiting';
  return input.requestKey === input.renderedKey && input.frontId === input.newestId ? 'current' : 'updating';
}

export const PREVIEW_STATUS_LABEL: Record<PreviewStatus, string> = {
  waiting: 'Updating...',
  updating: 'Updating...',
  current: 'Up to date',
  error: 'Not updated',
};
