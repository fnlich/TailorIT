'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from './icons';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<NoticeTone, string> = {
  info: 'bg-sky text-sky-foreground',
  success: 'bg-success-container text-[#02703c]',
  warning: 'bg-amber text-amber-foreground',
  error: 'bg-destructive-container text-[#b42625]',
};

const ICONS: Record<NoticeTone, ReactNode> = {
  info: <InfoIcon size={18} weight="fill" />,
  success: <CheckCircleIcon size={18} weight="fill" />,
  warning: <WarningCircleIcon size={18} weight="fill" />,
  error: <WarningCircleIcon size={18} weight="fill" />,
};

/**
 * An inline message block: the sign-in page's info/error lines, a form's failure. Errors and warnings are announced
 * (role="alert"); info and success politely (role="status").
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link at the end (e.g. "Try again"). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={clsx('flex items-start gap-2.5 rounded-control px-3.5 py-3 text-sm leading-5', TONES[tone], className)}
    >
      <span className="mt-px flex shrink-0">{ICONS[tone]}</span>
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
