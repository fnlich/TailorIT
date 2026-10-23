'use client';

import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/ArrowsOutSimple';
import { clsx } from 'clsx';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { FileTextIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';
import { previewResume, type PreviewAnswer, type PreviewBody } from '../api';
import { FullSizeViewer } from './FullSizeViewer';
import {
  NO_GUTTERS,
  PREVIEW_STATUS_LABEL,
  pageBreaks,
  previewScale,
  previewStatus,
  stablePaneWidth,
  type Gutters,
  type Measured,
} from './previewMath';

/*
 * The live preview: the draft drawn by the server (POST /api/resumes/preview, the same pipeline as the PDF) and
 * framed at its printed width, scaled to the pane.
 *  - Requests: typing waits out `debounceMs`, a discrete change goes at once; an answer no longer wanted is aborted,
 *    and a sequence number drops any that still arrives late. Nothing is sent while the pane is out of sight or while
 *    the draft is the one already drawn.
 *  - The last good page stays up: two frames take turns, the new document loads in the hidden one and is swapped in
 *    once loaded and measured, so typing never blanks the page. A failure leaves the last page under the error.
 *  - The frames are inert: sandboxed without scripts (same-origin only so this page can read the height), and the
 *    server's CSP forbids every fetch.
 */

type Doc = { id: number; key: string; answer: PreviewAnswer; measured: Measured | null };

interface State {
  slots: [Doc | null, Doc | null];
  front: 0 | 1 | null;
  renderedKey: string | null;
  error: string | null;
}

type Action =
  | { type: 'start' }
  | { type: 'arrived'; id: number; key: string; answer: PreviewAnswer }
  | { type: 'loaded'; slot: 0 | 1; id: number; measured: Measured | null }
  | { type: 'failed'; error: string };

const INITIAL: State = { slots: [null, null], front: null, renderedKey: null, error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return state.error ? { ...state, error: null } : state;
    case 'arrived': {
      // Into the slot NOT on screen, replacing a document still loading there: the newer one is wanted.
      const back: 0 | 1 = state.front === 0 ? 1 : 0;
      const slots: State['slots'] = [...state.slots];
      slots[back] = { id: action.id, key: action.key, answer: action.answer, measured: null };
      return { ...state, slots, renderedKey: action.key, error: null };
    }
    case 'loaded': {
      const doc = state.slots[action.slot];
      if (!doc || doc.id !== action.id) return state;
      const slots: State['slots'] = [...state.slots];
      slots[action.slot] = { ...doc, measured: action.measured };
      return { ...state, slots, front: action.slot };
    }
    case 'failed':
      return { ...state, error: action.error };
  }
}

/** The loaded document's height and its page margins, or null when it cannot be read. */
function measure(frame: HTMLIFrameElement): Measured | null {
  try {
    const root = frame.contentDocument?.documentElement;
    if (!root) return null;
    const style = (root.ownerDocument.defaultView ?? window).getComputedStyle(root);
    return { height: root.scrollHeight, padTop: parseFloat(style.paddingTop) || 0, padBottom: parseFloat(style.paddingBottom) || 0 };
  } catch {
    return null;
  }
}

const STATUS_DOT = {
  waiting: 'bg-warning',
  updating: 'bg-warning',
  current: 'bg-success',
  error: 'bg-destructive',
} as const;

export function PreviewPane({
  request,
  active,
  debounceMs,
  templateName,
  notes,
  scrolls,
}: {
  /** What to draw; its JSON is the key, so an unchanged draft is never sent again. */
  request: PreviewBody;
  /** False while the pane is hidden behind the Form switch. */
  active: boolean;
  debounceMs: number;
  /** A template id as its display name. */
  templateName: (templateId: string) => string;
  /** Lines about the page on screen (sample text, a fallback template), given the request it answered. */
  notes?: (shown: PreviewAnswer, request: PreviewBody) => ReactNode;
  /** The wide layout: the well scrolls itself; otherwise the window scrolls the page. */
  scrolls: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [retries, setRetries] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const sequence = useRef(0);
  const well = useRef<HTMLDivElement>(null);
  const gutters = useRef<Gutters>(NO_GUTTERS);

  const requestKey = JSON.stringify(request);
  // The first page goes at once; after a failure typing is debounced again, so a server that is down is not asked
  // once per keystroke.
  const firstRender = state.renderedKey === null && state.error === null;

  useEffect(() => {
    if (!active || requestKey === state.renderedKey) return;
    const controller = new AbortController();
    sequence.current += 1;
    const id = sequence.current;
    const timer = window.setTimeout(
      () => {
        dispatch({ type: 'start' });
        previewResume(JSON.parse(requestKey) as PreviewBody, controller.signal).then(
          (answer) => {
            if (id === sequence.current) dispatch({ type: 'arrived', id, key: requestKey, answer });
          },
          (error: unknown) => {
            if (controller.signal.aborted || id !== sequence.current) return;
            dispatch({ type: 'failed', error: userMessage(error, 'Could not draw the preview.') });
          },
        );
      },
      firstRender ? 0 : debounceMs,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `retries` re-runs it for the same draft after a failure.
  }, [active, requestKey, state.renderedKey, debounceMs, firstRender, retries]);

  // The well's width is state, but never its width as it stands (a scrollbar coming in would shake the page).
  useEffect(() => {
    const element = well.current;
    if (!element) return;
    gutters.current = NO_GUTTERS;
    const read = () => {
      const style = window.getComputedStyle(element);
      const px = (value: string) => parseFloat(value) || 0;
      const { width, gutters: next } = stablePaneWidth(
        {
          outerWidth: element.getBoundingClientRect().width,
          clientWidth: element.clientWidth,
          borderX: px(style.borderLeftWidth) + px(style.borderRightWidth),
          paddingX: px(style.paddingLeft) + px(style.paddingRight),
          scrolls,
          windowBar: window.innerWidth - document.documentElement.getBoundingClientRect().width,
        },
        gutters.current,
      );
      gutters.current = next;
      setPaneWidth(width);
    };
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrolls]);

  const onFrameLoad = useCallback((slot: 0 | 1, id: number, frame: HTMLIFrameElement) => {
    dispatch({ type: 'loaded', slot, id, measured: measure(frame) });
  }, []);

  const frontDoc = state.front === null ? null : state.slots[state.front];
  const shown = frontDoc?.answer ?? null;
  const pageWidth = shown?.page.widthPx || 794;
  const pageHeight = shown?.page.heightPx || 1123;
  const docHeight = Math.max(frontDoc?.measured?.height ?? pageHeight, pageHeight);
  const scale = previewScale(paneWidth, pageWidth);
  const breaks = pageBreaks(frontDoc?.measured ?? null, shown?.page);
  const newestId = Math.max(0, ...state.slots.map((doc) => doc?.id ?? 0));
  const status = previewStatus({
    failed: state.error !== null,
    shown: shown !== null,
    requestKey,
    renderedKey: state.renderedKey,
    frontId: frontDoc?.id ?? null,
    newestId,
  });

  const frames = ([0, 1] as const).flatMap((slot) => {
    const doc = state.slots[slot];
    if (!doc) return [];
    const isFront = state.front === slot;
    return [
      <iframe
        key={doc.id}
        title={isFront ? 'Resume preview' : 'Resume preview (loading)'}
        srcDoc={doc.answer.html}
        sandbox="allow-same-origin"
        scrolling="no"
        tabIndex={-1}
        aria-hidden={!isFront}
        data-front={isFront ? 'true' : 'false'}
        onLoad={(event) => onFrameLoad(slot, doc.id, event.currentTarget)}
        className={clsx('pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white', !isFront && 'invisible')}
        style={{
          width: doc.answer.page.widthPx,
          height: isFront ? Math.max(doc.measured?.height ?? 0, doc.answer.page.heightPx) : doc.answer.page.heightPx,
          transform: `scale(${scale})`,
        }}
      />,
    ];
  });

  const noteContent = shown && frontDoc ? notes?.(shown, JSON.parse(frontDoc.key) as PreviewBody) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
          <h2 className="sr-only">Preview</h2>
          <FileTextIcon size={18} className="shrink-0" />
          <p className="truncate" data-preview-template>
            {shown ? templateName(shown.templateId) : 'Drawing the first page...'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            role="status"
            data-preview-status={status}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-medium text-muted-foreground shadow-control"
          >
            <span aria-hidden="true" className={clsx('size-2 rounded-full', STATUS_DOT[status])} />
            {PREVIEW_STATUS_LABEL[status]}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!shown}
            icon={<ArrowsOutSimpleIcon size={14} />}
            onClick={() => setViewerOpen(true)}
          >
            Full size
          </Button>
        </div>
      </div>

      {(state.error || noteContent) && (
        <div className="flex flex-col gap-2 pb-3">
          {state.error && (
            <Notice
              tone="error"
              title="Could not draw the preview"
              action={
                <Button variant="outline" size="sm" onClick={() => setRetries((count) => count + 1)}>
                  Try again
                </Button>
              }
            >
              {state.error}
              {shown ? ' The page below is the last one that rendered.' : ''}
            </Notice>
          )}
          {noteContent}
        </div>
      )}

      <div
        ref={well}
        data-preview-well
        className={clsx('min-h-0 flex-1 px-1 pt-1 pb-6', scrolls && 'overflow-y-auto [scrollbar-gutter:stable]')}
      >
        {state.slots.some(Boolean) && scale > 0 ? (
          <div
            className="relative mx-auto overflow-hidden rounded-[4px] bg-white shadow-[0_1px_3px_rgb(0_0_0/0.06),0_18px_40px_-20px_rgb(0_0_0/0.25)] ring-1 ring-black/[0.06]"
            style={{ width: pageWidth * scale, height: docHeight * scale }}
          >
            {frames}
            {breaks.map((y, index) => (
              <div
                key={y}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#9a9a9a]"
                style={{ top: y * scale }}
              >
                <span className="absolute top-1 right-1.5 rounded bg-white/95 px-1.5 text-[11px] leading-5 font-semibold text-muted-foreground shadow-control">
                  Page {index + 2}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="mx-auto flex items-center justify-center rounded-[4px] bg-white ring-1 ring-black/[0.06]"
            style={{ width: paneWidth > 0 ? Math.min(paneWidth, 794) : '100%', aspectRatio: '794 / 1123' }}
          >
            {state.error ? (
              <span className="text-sm text-muted-foreground">Nothing to show yet.</span>
            ) : (
              <Spinner size={18} label="Drawing the preview..." />
            )}
          </div>
        )}
      </div>

      {shown && (
        <FullSizeViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          html={shown.html}
          widthPx={pageWidth}
          heightPx={docHeight}
          templateName={templateName(shown.templateId)}
        />
      )}
    </div>
  );
}
