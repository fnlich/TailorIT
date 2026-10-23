import { clsx } from 'clsx';

/** A grey placeholder block while content loads (pulses unless reduced motion is preferred). */
export function Skeleton({ className, rounded = 'md' }: { className?: string; rounded?: 'md' | 'full' | 'control' | 'surface' }) {
  const radius = { md: 'rounded-md', full: 'rounded-full', control: 'rounded-control', surface: 'rounded-surface' }[rounded];
  return <span aria-hidden="true" className={clsx('block animate-pulse bg-black/[0.06] motion-reduce:animate-none', radius, className)} />;
}

/** A few skeleton lines of text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={clsx('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={clsx('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}
