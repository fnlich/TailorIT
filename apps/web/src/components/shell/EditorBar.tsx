'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { forwardRef, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { CaretRightIcon, CheckIcon, FileTextIcon, InfoIcon, PencilSimpleIcon, XIcon } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { userMessage } from '@/lib/api';
import { PAGE_GUTTER } from './layout';
import { LogoMark, Wordmark } from './Logo';

export interface EditorBarProps {
  /** The document's name, shown last in the breadcrumb. */
  name: string;
  /** Where "Documents" goes back to, e.g. "/documents?tab=templates". */
  documentsHref?: string;
  /**
   * Enables the ✎ inline rename. Resolve to finish; reject to stay in edit mode with the error's sentence.
   */
  onRename?: (name: string) => Promise<void> | void;
  /** Checks a candidate name; return the sentence to show ("Template name must be at least 3 characters long"). */
  validateName?: (name: string) => string | null;
  /** A validation message from outside (e.g. the server refused the name). */
  renameError?: string | null;
  maxNameLength?: number;
  /** The ⓘ tooltip after the name. */
  info?: ReactNode;
  /** Save state text ("Saving…", "Saved just now", "Error saving"). Hidden below 640 px. */
  status?: ReactNode;
  /** Buttons at the right (EditorBarButton "Export Cover Letter", ☰ menu…). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The 62 px bar of full-screen editors (Simplify's template editor): logo › Documents › {name} ✎ ⓘ, a save-status
 * slot and the editor's actions on the right.
 *
 * Narrow screens keep the name readable: the wordmark goes below 1024 px; EditorBarButton actions are their icons
 * alone below 768 px (a short label up to 1024 px); below 640 px "Documents" is its icon alone (still the link's name)
 * and the ⓘ and the status go. The ✎ stays at every width (a template has no other way to be renamed on a phone).
 * The breadcrumb shrinks and is clipped at its edge, so nothing in it can paint over the actions.
 */
export function EditorBar({
  name,
  documentsHref = '/documents',
  onRename,
  validateName,
  renameError,
  maxNameLength = 120,
  info,
  status,
  actions,
  className,
}: EditorBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const shownError = error ?? (editing ? (renameError ?? null) : null);

  const begin = () => {
    setDraft(name);
    setError(null);
    setEditing(true);
    requestAnimationFrame(() => input.current?.select());
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(name);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!onRename) return;
    const next = draft.trim();
    const problem = validateName?.(next) ?? (next ? null : 'Enter a name.');
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
      setError(null);
    } catch (caught) {
      setError(userMessage(caught, 'Could not rename it. Please try again.'));
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <header
      data-editor-bar
      className={clsx('sticky top-0 z-30 h-[63px] shrink-0 border-b border-border bg-surface', className)}
    >
      <div className={clsx('flex h-full items-center gap-3', PAGE_GUTTER)}>
        {/*
         * The px-2/-mx-2 pair leaves room for focus rings at the clipped edges. The clip is horizontal only (and off
         * while renaming), so the rename error below the bar is never cut.
         */}
        <nav
          aria-label="Breadcrumb"
          className={clsx('-mx-2 flex min-w-0 flex-1 items-center px-2', !editing && 'overflow-x-clip')}
        >
          <ol className="flex min-w-0 items-center gap-2.5 text-sm">
            <li className="flex shrink-0 items-center">
              <Link href="/jobs" aria-label="TailorIT, go to Jobs" className="flex items-center gap-2 rounded-control outline-offset-4">
                <LogoMark size={26} />
                <Wordmark size={20} className="max-lg:hidden" />
              </Link>
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-subtle-foreground">
              <CaretRightIcon size={12} />
            </li>
            <li className="flex shrink-0 items-center">
              <Link
                href={documentsHref}
                className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground max-sm:py-1"
              >
                <FileTextIcon size={16} />
                <span className="max-sm:sr-only">Documents</span>
              </Link>
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-subtle-foreground">
              <CaretRightIcon size={12} />
            </li>
            <li className="flex min-w-0 items-center gap-1.5 sm:relative" aria-current="page">
              {editing ? (
                <form onSubmit={(event) => void submit(event)} className="flex min-w-0 items-center gap-1">
                  <input
                    ref={input}
                    value={draft}
                    maxLength={maxNameLength}
                    aria-label="Document name"
                    aria-invalid={shownError ? true : undefined}
                    aria-describedby={shownError ? errorId : undefined}
                    disabled={saving}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancel();
                      }
                    }}
                    autoFocus
                    className="h-8 w-[min(22rem,40vw)] min-w-0 rounded-control border border-control-focus bg-surface px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:outline-none aria-[invalid=true]:border-[#e88a89]"
                  />
                  <IconButton
                    type="submit"
                    label="Save name"
                    size="sm"
                    disabled={saving}
                    icon={saving ? <Spinner size={14} /> : <CheckIcon size={16} weight="bold" className="text-success" />}
                  />
                  <IconButton label="Cancel rename" size="sm" icon={<XIcon size={16} />} onClick={cancel} disabled={saving} />
                  {shownError && (
                    // Under the name from 640 px; below that, under the whole bar (the header is its box), wrapping.
                    <span
                      id={errorId}
                      role="alert"
                      className="absolute top-full mt-1 rounded-md bg-surface px-2 py-1 text-xs text-[#c62a29] shadow-popover max-sm:inset-x-4 sm:left-0 sm:whitespace-nowrap"
                    >
                      {shownError}
                    </span>
                  )}
                </form>
              ) : (
                <>
                  <span className="truncate font-semibold text-foreground" title={name}>
                    {name}
                  </span>
                  {onRename && (
                    <IconButton label="Rename" size="xs" icon={<PencilSimpleIcon size={14} />} onClick={begin} />
                  )}
                  {info && (
                    <Tooltip content={info} side="bottom">
                      <button
                        type="button"
                        aria-label="About this name"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground max-sm:hidden"
                      >
                        <InfoIcon size={16} />
                      </button>
                    </Tooltip>
                  )}
                </>
              )}
            </li>
          </ol>
        </nav>
        {status && (
          <div role="status" className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground max-sm:hidden">
            {status}
          </div>
        )}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface EditorBarButtonProps extends Omit<ButtonProps, 'children'> {
  /** The words ("Export Cover Letter"): shown from 768 px, and always the button's accessible name. */
  label: string;
  /** Fewer words for 768-1023 px ("Export"), where a long label would squeeze the document's name. */
  shortLabel?: string;
  /** Required: below 768 px the button is this icon alone. */
  icon: ReactNode;
}

/**
 * An action for EditorBar's `actions`: a kit Button with its icon and label, which turns into a 36 px icon button
 * below 768 px (and shows `shortLabel`, if any, up to 1024 px), so the document's name keeps its room. The full
 * label is always the button's accessible name.
 */
export const EditorBarButton = forwardRef<HTMLButtonElement, EditorBarButtonProps>(function EditorBarButton(
  { label, shortLabel, className, ...rest },
  ref,
) {
  return (
    <Button ref={ref} className={clsx('max-md:w-9 max-md:px-0', className)} {...rest}>
      <span className="max-md:sr-only">
        {shortLabel ? (
          <>
            <span aria-hidden="true" className="max-md:hidden lg:hidden">
              {shortLabel}
            </span>
            <span className="max-lg:sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </Button>
  );
});
