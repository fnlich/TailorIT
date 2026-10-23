import { AddressBookIcon } from '@phosphor-icons/react/AddressBook';
import { BookIcon } from '@phosphor-icons/react/Book';
import { BookOpenIcon } from '@phosphor-icons/react/BookOpen';
import { BriefcaseIcon } from '@phosphor-icons/react/Briefcase';
import { CertificateIcon } from '@phosphor-icons/react/Certificate';
import { FolderIcon } from '@phosphor-icons/react/Folder';
import { GraduationCapIcon } from '@phosphor-icons/react/GraduationCap';
import { HandHeartIcon } from '@phosphor-icons/react/HandHeart';
import { ListIcon } from '@phosphor-icons/react/List';
import { ShieldCheckIcon } from '@phosphor-icons/react/ShieldCheck';
import { StarIcon } from '@phosphor-icons/react/Star';
import { TextAlignLeftIcon } from '@phosphor-icons/react/TextAlignLeft';
import { TranslateIcon } from '@phosphor-icons/react/Translate';
import { TrophyIcon } from '@phosphor-icons/react/Trophy';
import { UsersThreeIcon } from '@phosphor-icons/react/UsersThree';
import { WrenchIcon } from '@phosphor-icons/react/Wrench';
import type { SectionIcon } from '@tailorit/shared/resume';
import type { Icon } from '@/components/ui/icons';

/** The catalogue's icon names (Phosphor's) as components, one module per icon. */
export const SECTION_ICONS: Record<SectionIcon, Icon> = {
  'text-align-left': TextAlignLeftIcon,
  'shield-check': ShieldCheckIcon,
  wrench: WrenchIcon,
  'users-three': UsersThreeIcon,
  briefcase: BriefcaseIcon,
  'graduation-cap': GraduationCapIcon,
  certificate: CertificateIcon,
  folder: FolderIcon,
  'hand-heart': HandHeartIcon,
  trophy: TrophyIcon,
  'book-open': BookOpenIcon,
  book: BookIcon,
  translate: TranslateIcon,
  star: StarIcon,
  'address-book': AddressBookIcon,
  list: ListIcon,
};

/** A section's icon in its tinted tile (cards, Add content tiles). */
export function SectionGlyph({ icon, size = 36 }: { icon: SectionIcon; size?: 32 | 36 | 40 }) {
  const Glyph = SECTION_ICONS[icon];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-control bg-primary-container text-primary-ink"
      style={{ width: size, height: size }}
    >
      <Glyph size={size >= 40 ? 20 : 18} />
    </span>
  );
}
