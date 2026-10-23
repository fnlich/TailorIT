'use client';

import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { bulkDeleteSentence, titleCase } from './gallery';
import type { Noun } from './types';

/**
 * Simplify's bulk delete confirmation: "Delete Resumes" / "Delete Cover Letters" / "Delete Templates", the
 * sentence above, an optional note ("1 default resume will be skipped") and the button "Delete Bulk".
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  count,
  noun,
  note,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  noun: Noun;
  note?: ReactNode;
  /** Resolve when the documents are gone; reject to keep the dialog open with the error shown. */
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${titleCase(noun.many)}`}
      description={bulkDeleteSentence(count, noun)}
      confirmLabel="Delete Bulk"
      busyLabel="Deleting..."
      tone="destructive"
      onConfirm={onConfirm}
    >
      {note ? <p className="text-muted-foreground">{note}</p> : null}
    </ConfirmDialog>
  );
}
