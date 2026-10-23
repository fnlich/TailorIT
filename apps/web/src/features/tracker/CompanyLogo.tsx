'use client';

import { clsx } from 'clsx';
import { useState } from 'react';
import { LetterAvatar, lettersOf } from '@/components/ui/LetterAvatar';

/**
 * A company's logo (tracker cards 32 px, list rows and the detail header 64 px), or its first letter on #e8e8e8 when
 * there is no logo or it fails to load.
 */
export function CompanyLogo({
  name,
  logoUrl,
  size,
  className,
}: {
  name: string;
  logoUrl: string | null;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const radius = size >= 48 ? 12 : 8;
  if (logoUrl && failed !== logoUrl) {
    return (
      // Logos come from any host the job board names, so next/image (which needs each host configured) is not used.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(logoUrl)}
        className={clsx('shrink-0 border border-border bg-surface object-contain', className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return <LetterAvatar letters={lettersOf(name || '?')} size={size} tone="neutral" className={className} />;
}
