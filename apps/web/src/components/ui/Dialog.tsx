'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { IconButton } from './IconButton';
import { XIcon } from './icons';

/*
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent title="Change resume name" description="…">
 *       …
 *       <DialogFooter><Button variant="outline" onClick={…}>Keep it</Button><Button>Change</Button></DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 * Escape and an outside press close the top-most dialog only; focus is trapped and returns to the opener.
 */

export function Dialog(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />;
}

export function DialogTrigger(props: ComponentProps<typeof BaseDialog.Trigger>) {
  return <BaseDialog.Trigger {...props} />;
}

export const DialogClose = BaseDialog.Close;

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export const BACKDROP =
  'fixed inset-0 z-50 min-h-dvh bg-overlay transition-opacity duration-200 ease-out-soft ' +
  'data-starting-style:opacity-0 data-ending-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute';

export interface DialogContentProps {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  /** The ✕ in the corner (default on). */
  showClose?: boolean;
  className?: string;
  initialFocus?: ComponentProps<typeof BaseDialog.Popup>['initialFocus'];
  finalFocus?: ComponentProps<typeof BaseDialog.Popup>['finalFocus'];
}

/** A centred white dialog (radius 16, dialog shadow) over a 40% black backdrop. */
export function DialogContent({
  children,
  title,
  description,
  size = 'md',
  showClose = true,
  className,
  initialFocus,
  finalFocus,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={BACKDROP} />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
        <BaseDialog.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          className={clsx(
            'relative flex max-h-full w-full flex-col rounded-surface bg-surface p-6 text-foreground shadow-dialog outline-none',
            'transition-[opacity,scale] duration-200 ease-out-soft data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.97] data-ending-style:opacity-0',
            SIZES[size],
            className,
          )}
        >
          {(title || description) && (
            <div className={clsx('flex flex-col gap-1.5', showClose && 'pr-8')}>
              {title && <DialogTitle>{title}</DialogTitle>}
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          )}
          {children}
          {showClose && (
            <BaseDialog.Close
              render={<IconButton label="Close" icon={<XIcon size={18} />} size="sm" tooltip={false} className="absolute top-4 right-4" />}
            />
          )}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseDialog.Title className={clsx('text-lg leading-7 font-semibold tracking-tight text-foreground', className)}>
      {children}
    </BaseDialog.Title>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseDialog.Description className={clsx('text-sm leading-5 text-muted-foreground', className)}>
      {children}
    </BaseDialog.Description>
  );
}

/**
 * Right-aligned buttons at the bottom of a dialog, 24 px under the content. `flush` drops that margin (inside a
 * form that already spaces its children).
 */
export function DialogFooter({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-end gap-3', !flush && 'mt-6', className)}>{children}</div>
  );
}
