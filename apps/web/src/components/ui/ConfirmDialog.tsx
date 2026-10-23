'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import { userMessage } from '@/lib/api';
import { Button, type ButtonVariant } from './Button';
import { BACKDROP } from './Dialog';
import { Notice } from './Notice';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between the description and the buttons (e.g. "1 default resume will be skipped"). */
  children?: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while `onConfirm` runs. */
  busyLabel?: string;
  cancelLabel?: string;
  tone?: 'destructive' | 'primary';
  /**
   * Runs on confirm. Resolve to close the dialog; reject to keep it open with the error's sentence shown
   * (ApiError messages are used as-is).
   */
  onConfirm: () => Promise<void> | void;
}

/**
 * A yes/no question that must be answered (Simplify: "Delete Application" / "Are you sure you want to delete this
 * application? You won't be able to undo this action."). Built on Base UI AlertDialog: no outside-press dismissal.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(userMessage(caught, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const variant: ButtonVariant = tone === 'destructive' ? 'destructive' : 'primary';
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Popup
            className={clsx(
              'w-full max-w-md rounded-surface bg-surface p-6 text-foreground shadow-dialog outline-none',
              'transition-[opacity,scale] duration-200 ease-out-soft data-starting-style:scale-[0.97] data-starting-style:opacity-0',
              'data-ending-style:scale-[0.97] data-ending-style:opacity-0',
            )}
          >
            <AlertDialog.Title className="text-lg leading-7 font-semibold tracking-tight">{title}</AlertDialog.Title>
            {description && (
              <AlertDialog.Description className="mt-2 text-sm leading-5 text-muted-foreground">
                {description}
              </AlertDialog.Description>
            )}
            {children && <div className="mt-3 text-sm">{children}</div>}
            {error && (
              <Notice tone="error" className="mt-4">
                {error}
              </Notice>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <AlertDialog.Close render={<Button variant="outline" disabled={busy} />}>{cancelLabel}</AlertDialog.Close>
              <Button variant={variant} loading={busy} onClick={() => void confirm()}>
                {busy && busyLabel ? busyLabel : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
