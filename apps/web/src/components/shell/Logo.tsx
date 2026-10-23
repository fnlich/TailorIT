import { clsx } from 'clsx';

/**
 * TailorIT's own mark: a rounded teal tile with a white "T" over a stitched seam. (Simplify's logo and wordmark are
 * brand assets and are never used.)
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={clsx('shrink-0', className)}
    >
      <rect width="32" height="32" rx="9" fill="#14a1c0" />
      <rect x="7.5" y="7" width="17" height="4.5" rx="2.25" fill="#fff" />
      <rect x="13.75" y="7" width="4.5" height="15" rx="2.25" fill="#fff" />
      <path d="M8 25.75h16" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="2.25 2.75" opacity="0.9" />
    </svg>
  );
}

/** "TailorIT" set in the UI face, extra-bold and tightly tracked. */
export function Wordmark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx('font-extrabold leading-none tracking-[-0.035em] whitespace-nowrap text-foreground', className)}
      style={{ fontSize: size }}
    >
      Tailor<span className="text-primary">IT</span>
    </span>
  );
}

/** Mark + wordmark, as the header and sign-in page show them. */
export function Logo({
  markSize = 28,
  wordSize = 22,
  gap = 8,
  className,
}: {
  markSize?: number;
  wordSize?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <span className={clsx('inline-flex items-center', className)} style={{ gap }}>
      <LogoMark size={markSize} />
      <Wordmark size={wordSize} />
    </span>
  );
}
