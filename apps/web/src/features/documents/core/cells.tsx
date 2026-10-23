'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PencilSimpleIcon } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { ActionMenu } from './ActionMenu';
import type { ActionMenuItem } from './types';

/*
 * Cell renderers for DocumentList columns, in Simplify's table style. A tab builds its columns from these:
 *   { key: 'name', header: 'Name', track: 'minmax(0,1.06fr)', cell: (r) => <DocumentNameCell name={r.title} badges={…} /> }
 */

/** The main cell: the name (14 px semibold, wraps) with badges under it and an optional preview line. */
export function DocumentNameCell({
  name,
  href,
  onOpen,
  badges,
  preview,
}: {
  name: string;
  href?: string;
  onOpen?: () => void;
  /** <Badge/>s: Default, Uploaded, PDF, Generated, System Default… */
  badges?: ReactNode;
  /** A muted line under the badges (templates: the first 80 characters of the body). */
  preview?: ReactNode;
}) {
  // Simplify sets the name solid (14 px lines) with the badges 8 px under it: 76 px rows, 90 px for two lines.
  const nameClasses =
    'text-left text-sm leading-none font-semibold text-foreground [overflow-wrap:anywhere] hover:underline hover:underline-offset-2';
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {href ? (
        <Link href={href} className={nameClasses}>
          {name}
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className={nameClasses}>
          {name}
        </button>
      ) : (
        <span className="text-sm leading-none font-semibold text-foreground [overflow-wrap:anywhere]">{name}</span>
      )}
      {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
      {preview && <p className="line-clamp-1 text-[13px] leading-4 text-muted-foreground">{preview}</p>}
    </div>
  );
}

/** A plain text cell ("3 days ago", "-"). */
export function TextCell({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={clsx('text-sm', muted ? 'text-muted-foreground' : 'text-foreground')}>{children}</span>;
}

/**
 * Simplify's row actions: "✎ Edit" (greyed when the document cannot be edited, e.g. an uploaded PDF) and "More ⌄".
 */
export function TableRowActions({
  label,
  editHref,
  onEdit,
  editDisabled,
  editDisabledReason,
  editLabel = 'Edit',
  menuItems,
}: {
  /** The document's name, for "Edit {label}" / "Actions for {label}". */
  label: string;
  editHref?: string;
  onEdit?: () => void;
  editDisabled?: boolean;
  editDisabledReason?: string;
  editLabel?: string;
  menuItems?: readonly ActionMenuItem[];
}) {
  const classes = clsx(
    'inline-flex h-8 shrink-0 items-center gap-2 rounded-control -ml-2 px-2 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150',
    // Simplify greys "Edit" out (#b7b7b7) for documents that cannot be edited, e.g. an uploaded PDF.
    editDisabled ? 'cursor-not-allowed text-disabled-foreground' : 'text-foreground hover:bg-hover active:bg-black/[0.08]',
  );
  const content = (
    <>
      <PencilSimpleIcon size={14} />
      {editLabel}
      <span className="sr-only"> {label}</span>
    </>
  );
  let edit: ReactNode = null;
  if (editDisabled) {
    edit = (
      <Tooltip content={editDisabledReason} disabled={!editDisabledReason}>
        <button type="button" aria-disabled="true" className={classes}>
          {content}
        </button>
      </Tooltip>
    );
  } else if (editHref) {
    edit = (
      <Link href={editHref} className={classes}>
        {content}
      </Link>
    );
  } else if (onEdit) {
    edit = (
      <button type="button" onClick={onEdit} className={classes}>
        {content}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {edit}
      {menuItems && menuItems.length > 0 && <ActionMenu items={menuItems} label={`Actions for ${label}`} trigger="more" />}
    </div>
  );
}
