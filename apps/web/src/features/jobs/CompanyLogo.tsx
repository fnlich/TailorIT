'use client';

import { clsx } from 'clsx';
import { useState } from 'react';
import { LetterAvatar, lettersOf } from '@/components/ui/LetterAvatar';

/**
 * A company's logo (40 px on cards, 48 px in the detail), or its first letter on #e8e8e8 when there is none or the
 * image fails to load.
 */
export function CompanyLogo({ name, url, size = 40, className }: { name: string; url: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return <LetterAvatar letters={lettersOf(name)} size={size} tone="neutral" className={className} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos come from many hosts; next/image needs each listed.
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={clsx('shrink-0 bg-surface object-contain', className)}
      style={{ width: size, height: size, borderRadius: size >= 40 ? 10 : 8 }}
    />
  );
}
