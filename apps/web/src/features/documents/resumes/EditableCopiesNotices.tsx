'use client';

import type { ResumeCopiesPause, ResumeCopy } from '@tailorit/shared/resume';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, buttonClasses, type ButtonVariant } from '@/components/ui/Button';
import { CheckCircleIcon, WarningCircleIcon } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import { changeResumeCopies, fetchResumeCopies, resumeEditorHref, resumeKeys } from '../../resume-editor/api';
import {
  COPY_POLL_MS,
  activeLine,
  activeTitle,
  copiesActive,
  copyMadeSince,
  copyStateText,
  finishedNotice,
  groupCopies,
  readyCopyIds,
  retryCopiesText,
  stopCopiesText,
  type CopyBatch,
  type FinishedNotice,
} from './copies';

type CopyAction = 'stop' | 'retry' | 'dismiss';

const FAILED: Record<CopyAction, string> = {
  stop: 'Could not stop the copies',
  retry: 'Could not try the copies again',
  dismiss: 'Could not dismiss the copies',
};

/** The colours of the kit's Notice: sky while copies are made, amber while they wait for a pause, then how it ended. */
const BOX_TONES: Record<'making' | 'paused' | FinishedNotice['tone'], string> = {
  making: 'bg-sky text-sky-foreground',
  paused: 'bg-amber text-amber-foreground',
  success: 'bg-success-container text-[#02703c]',
  warning: 'bg-amber text-amber-foreground',
  error: 'bg-destructive-container text-[#b42625]',
};

/**
 * The editable copies of several uploads (Upload with "Make an editable copy with AI" for many files), one notice per
 * Upload dialog, kept by the server: read from GET /api/resumes/copies, again every 3 s while a copy waits or is being
 * made (only while the page is visible), so a notice is still there after a reload. Stop the rest, Try again and
 * Dismiss act on the server. With no answer (loading, or an API without the copy line) it shows nothing.
 */
export function EditableCopiesNotices() {
  const queryClient = useQueryClient();
  const now = useNow();
  const query = useQuery({
    queryKey: resumeKeys.copies(),
    queryFn: ({ signal }) => fetchResumeCopies(signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (current) => (copiesActive(current.state.data) ? COPY_POLL_MS : false),
  });
  const view = query.data;

  // A copy made joins the list: it is read again when a copy is ready that was not in the view before (by id, as
  // Dismiss takes ready copies out of the view). Only the list: reading every resume query would read this one too.
  const seenReady = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!view) return;
    const ready = readyCopyIds(view);
    if (copyMadeSince(seenReady.current, ready)) void queryClient.invalidateQueries({ queryKey: resumeKeys.list() });
    seenReady.current = ready;
  }, [view, queryClient]);

  if (!view) return null;
  const batches = groupCopies(view.items);
  if (batches.length === 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-3">
      {batches.map((batch) => (
        <CopyBatchNotice key={batch.batchId} batch={batch} paused={view.paused} now={now} />
      ))}
    </div>
  );
}

/**
 * A notice box like the kit's Notice, but only its sentences are a live region: the buttons and the details list sit
 * outside it, so a row that changes or a list shown is not read out again with the whole box.
 */
function CopyBox({
  batchId,
  tone,
  icon,
  live,
  sentences,
  controls,
}: {
  batchId: string;
  tone: keyof typeof BOX_TONES;
  icon: ReactNode;
  live: 'status' | 'alert';
  sentences: ReactNode;
  /** The buttons and the details list. */
  controls: ReactNode;
}) {
  return (
    <div data-copy-batch={batchId} className={clsx('flex items-start gap-2.5 rounded-control px-3.5 py-3 text-sm leading-5', BOX_TONES[tone])}>
      {icon}
      <div className="min-w-0 flex-1 break-words">
        {/* A new node when it turns into an alert, as an alert is announced when it appears. */}
        <div key={live} role={live}>
          {sentences}
        </div>
        {controls}
      </div>
    </div>
  );
}

/** One batch: a status box while copies wait or are made, then a notice of how it ended. */
function CopyBatchNotice({ batch, paused, now }: { batch: CopyBatch; paused: ResumeCopiesPause | null; now: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState<CopyAction | null>(null);
  const one = batch.counts.total === 1;

  const act = async (action: CopyAction) => {
    setPending(action);
    try {
      const answer = await changeResumeCopies(batch.batchId, action);
      // A read already under way may hold the copies as they were before: this answer wins.
      await queryClient.cancelQueries({ queryKey: resumeKeys.copies() });
      queryClient.setQueryData(resumeKeys.copies(), answer);
    } catch (error) {
      toast.error(FAILED[action], userMessage(error, 'Please try again.'));
    } finally {
      setPending(null);
    }
  };

  // Keyed, so a button keeps its own element when the box turns from being made to finished: a focused "Hide details"
  // never becomes "Try again".
  const actionButton = (action: CopyAction, label: string, variant: ButtonVariant = 'outline') => (
    <Button
      key={action}
      variant={variant}
      size="sm"
      loading={pending === action}
      disabled={pending !== null && pending !== action}
      onClick={() => void act(action)}
    >
      {label}
    </Button>
  );
  const detailsButton = one ? null : (
    <Button key="details" variant="ghost" size="sm" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
      {details ? 'Hide details' : 'Show details'}
    </Button>
  );
  const list = details && !one ? <CopyList items={batch.items} /> : null;
  const below = (buttons: ReactNode) => (
    <>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {list}
    </>
  );

  if (batch.active) {
    const waits = batch.counts.waiting > 0;
    return (
      <CopyBox
        batchId={batch.batchId}
        tone={paused && waits ? 'paused' : 'making'}
        icon={
          <span className="mt-0.5 flex shrink-0">
            <Spinner size={16} />
          </span>
        }
        live="status"
        sentences={
          <>
            <p className="font-semibold">{activeTitle(batch)}</p>
            <p className="mt-0.5">{activeLine(batch, paused, now)}</p>
          </>
        }
        controls={
          (waits || detailsButton) && (
            <div className="mt-2">
              {below(
                <>
                  {waits && actionButton('stop', stopCopiesText(batch))}
                  {detailsButton}
                </>,
              )}
            </div>
          )
        }
      />
    );
  }

  const notice = finishedNotice(batch);
  const only = one ? batch.items[0] : null;
  return (
    <CopyBox
      batchId={batch.batchId}
      tone={notice.tone}
      icon={
        <span className="mt-px flex shrink-0">
          {notice.tone === 'success' ? <CheckCircleIcon size={18} weight="fill" /> : <WarningCircleIcon size={18} weight="fill" />}
        </span>
      }
      // As the kit's Notice: a success is said politely, a warning or an error at once.
      live={notice.tone === 'success' ? 'status' : 'alert'}
      sentences={
        <>
          <p className="font-semibold">{notice.title}</p>
          <div className="mt-0.5">{notice.body}</div>
        </>
      }
      controls={
        <div className="mt-2">
          {below(
            <>
              {only?.state === 'ready' && only.resumeId && (
                <Link key="open" href={resumeEditorHref(only.resumeId)} className={buttonClasses({ size: 'sm' })}>
                  Open the resume
                </Link>
              )}
              {batch.counts.retryable > 0 && actionButton('retry', retryCopiesText(batch))}
              {detailsButton}
              {actionButton('dismiss', 'Dismiss', 'ghost')}
            </>,
          )}
        </div>
      }
    />
  );
}

/** "Show details": each copy of the batch and how it stands, with a link to each copy made. */
function CopyList({ items }: { items: readonly ResumeCopy[] }) {
  return (
    <ul aria-label="Editable copies" className="-mr-1 mt-2 flex max-h-[min(18rem,50vh)] flex-col gap-1.5 overflow-y-auto pr-1">
      {items.map((item) => (
        <li
          key={item.id}
          data-copy-row={item.label}
          data-copy-state={item.state}
          className="flex items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm leading-5 font-semibold text-foreground" title={item.label}>
              {item.label}
            </span>
            <span
              className={clsx(
                'text-[13px] leading-5 [overflow-wrap:anywhere]',
                item.state === 'failed' ? 'text-[#b42625]' : item.state === 'ready' ? 'text-[#02703c]' : 'text-muted-foreground',
              )}
            >
              {copyStateText(item)}
            </span>
          </span>
          {item.state === 'ready' && item.resumeId && (
            <Link
              href={resumeEditorHref(item.resumeId)}
              aria-label={`Open the copy of ${item.label}`}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              Open
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
