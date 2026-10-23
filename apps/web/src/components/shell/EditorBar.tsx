'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  /** Save state text ("Saving…", "Saved just now", "Error saving"). */
  status?: ReactNode;
  /** Buttons at the right ("Export Cover Letter", ☰ menu…). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The 62 px bar of full-screen editors (Simplify's template editor): logo › Documents › {name} ✎ ⓘ, a save-status
 * slot and the editor's actions on the right.
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
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
          <ol className="flex min-w-0 items-center gap-2.5 text-sm">
            <li className="flex shrink-0 items-center">
              <Link href="/jobs" aria-label="TailorIT, go to Jobs" className="flex items-center gap-2 rounded-control outline-offset-4">
                <LogoMark size={26} />
                <Wordmark size={20} className="max-md:hidden" />
              </Link>
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-subtle-foreground">
              <CaretRightIcon size={12} />
            </li>
            <li className="flex shrink-0 items-center">
              <Link
                href={documentsHref}
                className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground"
              >
                <FileTextIcon size={16} />
                Documents
              </Link>
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-subtle-foreground">
              <CaretRightIcon size={12} />
            </li>
            <li className="relative flex min-w-0 items-center gap-1.5" aria-current="page">
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
                    <span
                      id={errorId}
                      role="alert"
                      className="absolute top-full left-0 mt-1 rounded-md bg-surface px-2 py-1 text-xs whitespace-nowrap text-[#c62a29] shadow-popover"
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
                        className="inline-flex size-7 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
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
