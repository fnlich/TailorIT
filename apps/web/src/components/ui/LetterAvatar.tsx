import { clsx } from 'clsx';

export type LetterAvatarTone = 'brand' | 'neutral' | 'tint';

const TONES: Record<LetterAvatarTone, string> = {
  // the header's account square: #3ec0de, white bold initials
  brand: 'bg-avatar text-white font-bold',
  // tracker cards' company letter: #e8e8e8, muted letter
  neutral: 'bg-muted text-muted-foreground font-semibold',
  tint: 'bg-primary-container text-primary-ink font-semibold',
};

/** The letters to show for a name: "Acme Corp" → "A" (one) or "AC" (two). */
export function lettersOf(name: string, count: 1 | 2 = 1): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (count === 1 || words.length === 1) return (words[0] ?? '?').slice(0, count).toUpperCase();
  return `${words[0]?.[0] ?? ''}${words[words.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export interface LetterAvatarProps {
  /** The text to draw (already initials), e.g. initialsOf(name, email) or lettersOf(company). */
  letters: string;
  /** Pixel size of the square (32 tracker card, 40 header, 64 list row). */
  size?: number;
  tone?: LetterAvatarTone;
  shape?: 'rounded' | 'circle';
  /** When set, the avatar is announced with this text; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** A square (radius 10, or 8 when small) or circle with letters, for accounts and companies without a logo. */
export function LetterAvatar({ letters, size = 32, tone = 'neutral', shape = 'rounded', label, className }: LetterAvatarProps) {
  const radius = shape === 'circle' ? '9999px' : size >= 40 ? '10px' : '8px';
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={clsx('inline-flex shrink-0 items-center justify-center leading-none select-none', TONES[tone], className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.42) }}
    >
      {letters}
    </span>
  );
}
