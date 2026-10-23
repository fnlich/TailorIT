import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A 48 px tinted circle with an icon above the title. */
  icon?: ReactNode;
  /** A button (or two) under the text. */
  action?: ReactNode;
  /** "plain" sits inside a card; "dashed" draws its own dashed outline (Simplify's empty board column). */
  variant?: 'plain' | 'dashed';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Simplify's empty wording blocks: "Create your first resume!" / "Get started with a polished resume…", "No
 * applications" / "Move applications into screen.", "Oops! No matching cover letters found."
 */
export function EmptyState({ title, description, icon, action, variant = 'plain', size = 'md', className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-1 px-4 py-8' : 'gap-1.5 px-6 py-14',
        variant === 'dashed' && 'rounded-surface border border-dashed border-border',
        className,
      )}
    >
      {icon && (
        <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary-container text-primary-ink">
          {icon}
        </span>
      )}
      <p className={clsx('font-semibold text-foreground', size === 'sm' ? 'text-sm text-muted-foreground' : 'text-base')}>
        {title}
      </p>
      {description && (
        <p className={clsx('max-w-md text-muted-foreground', size === 'sm' ? 'text-xs' : 'text-sm leading-5')}>{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}
