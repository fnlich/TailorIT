import { clsx } from 'clsx';

/**
 * A spinning ring in the current text colour. With `label` it is announced (role="status"); without, it is
 * decorative (the busy control around it says what is happening).
 */
export function Spinner({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  const ring = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={clsx('shrink-0 animate-spin-slow', !label && className)}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return ring;
  return (
    <span role="status" className={clsx('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      {ring}
      <span>{label}</span>
    </span>
  );
}

/** A centred spinner with its sentence, for a page or panel that is loading. */
export function PageSpinner({ label = 'Loading...', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex min-h-[40vh] items-center justify-center', className)}>
      <Spinner size={20} label={label} />
    </div>
  );
}
