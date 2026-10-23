'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { BACKDROP } from './Dialog';
import { IconButton } from './IconButton';
import { XIcon } from './icons';

/*
 * A panel that slides in from the right edge (Simplify's "Add Application" at max-w-3xl and the application detail
 * at max-w-7xl). It is a positioned Base UI Dialog: modal, focus-trapped, Escape closes it.
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetContent title="Add Application" icon={…} footer={…}>…</SheetContent>
 *   </Sheet>
 */

export function Sheet(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />;
}

export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;

export type SheetSize = '3xl' | '7xl';

export interface SheetContentProps {
  children: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** A 40 px round badge before the title (Add Application: briefcase on #ccf6ff). */
  icon?: ReactNode;
  /** Buttons beside the close ✕ (detail view: Apply, Favorite, Archive, Delete). */
  headerActions?: ReactNode;
  /** Sticky bottom bar (Cancel / Add). */
  footer?: ReactNode;
  size?: SheetSize;
  className?: string;
  bodyClassName?: string;
  initialFocus?: ComponentProps<typeof BaseDialog.Popup>['initialFocus'];
}

export function SheetContent({
  children,
  title,
  description,
  icon,
  headerActions,
  footer,
  size = '3xl',
  className,
  bodyClassName,
  initialFocus,
}: SheetContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={BACKDROP} />
      <BaseDialog.Popup
        initialFocus={initialFocus}
        className={clsx(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface text-foreground shadow-dialog outline-none',
          'transition-transform duration-300 ease-out-soft data-starting-style:translate-x-full data-ending-style:translate-x-full',
          size === '7xl' ? 'sm:max-w-7xl' : 'sm:max-w-3xl',
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 py-4">
          {icon && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-primary-ink">
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-center">
            <BaseDialog.Title className="truncate text-lg leading-7 font-bold text-foreground">{title}</BaseDialog.Title>
            {description && (
              <BaseDialog.Description className="text-sm text-muted-foreground">{description}</BaseDialog.Description>
            )}
          </div>
          {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
          <BaseDialog.Close render={<IconButton label="Close" icon={<XIcon size={18} />} tooltip={false} />} />
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">{footer}</div>}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
