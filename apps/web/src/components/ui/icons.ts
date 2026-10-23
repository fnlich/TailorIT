/*
 * The Phosphor icons the shell and kit use, imported one module per icon (the package barrel would make every
 * dev compile walk ~9,000 icons). Feature code can add its own the same way:
 *   import { HeartIcon } from '@phosphor-icons/react/Heart';
 * Defaults (16 px, regular, aria-hidden) come from the IconContext in AppProviders; use weight="fill" for the
 * filled heart / bookmark / check-circle.
 */
// The package's "./lib" export points at a file it does not ship; the per-file "./dist/lib/*" export works.
export type { Icon, IconProps, IconWeight } from '@phosphor-icons/react/dist/lib/types';
export { IconContext } from '@phosphor-icons/react/dist/lib/context';

export { ArchiveIcon } from '@phosphor-icons/react/Archive';
export { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/ArrowCounterClockwise';
export { ArrowRightIcon } from '@phosphor-icons/react/ArrowRight';
export { ArrowSquareOutIcon } from '@phosphor-icons/react/ArrowSquareOut';
export { ArrowsClockwiseIcon } from '@phosphor-icons/react/ArrowsClockwise';
export { BookmarkSimpleIcon } from '@phosphor-icons/react/BookmarkSimple';
export { BriefcaseIcon } from '@phosphor-icons/react/Briefcase';
export { BuildingsIcon } from '@phosphor-icons/react/Buildings';
export { CalendarBlankIcon } from '@phosphor-icons/react/CalendarBlank';
export { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
export { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft';
export { CaretRightIcon } from '@phosphor-icons/react/CaretRight';
export { CaretUpIcon } from '@phosphor-icons/react/CaretUp';
export { CaretUpDownIcon } from '@phosphor-icons/react/CaretUpDown';
export { ChartLineIcon } from '@phosphor-icons/react/ChartLine';
export { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
export { CheckIcon } from '@phosphor-icons/react/Check';
export { CircleNotchIcon } from '@phosphor-icons/react/CircleNotch';
export { CirclesFourIcon } from '@phosphor-icons/react/CirclesFour';
export { ClockIcon } from '@phosphor-icons/react/Clock';
export { CopyIcon } from '@phosphor-icons/react/Copy';
export { DotsThreeIcon } from '@phosphor-icons/react/DotsThree';
export { DotsThreeVerticalIcon } from '@phosphor-icons/react/DotsThreeVertical';
export { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple';
export { EnvelopeIcon } from '@phosphor-icons/react/Envelope';
export { EyeIcon } from '@phosphor-icons/react/Eye';
export { EyeSlashIcon } from '@phosphor-icons/react/EyeSlash';
export { FileTextIcon } from '@phosphor-icons/react/FileText';
export { FunnelIcon } from '@phosphor-icons/react/Funnel';
export { GearSixIcon } from '@phosphor-icons/react/GearSix';
export { HeartIcon } from '@phosphor-icons/react/Heart';
export { InfoIcon } from '@phosphor-icons/react/Info';
export { KanbanIcon } from '@phosphor-icons/react/Kanban';
export { ListBulletsIcon } from '@phosphor-icons/react/ListBullets';
export { LockIcon } from '@phosphor-icons/react/Lock';
export { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass';
export { MapPinIcon } from '@phosphor-icons/react/MapPin';
export { MinusIcon } from '@phosphor-icons/react/Minus';
export { PaperPlaneTiltIcon } from '@phosphor-icons/react/PaperPlaneTilt';
export { PencilSimpleIcon } from '@phosphor-icons/react/PencilSimple';
export { PlusIcon } from '@phosphor-icons/react/Plus';
export { QuestionIcon } from '@phosphor-icons/react/Question';
export { RowsIcon } from '@phosphor-icons/react/Rows';
export { ShieldCheckIcon } from '@phosphor-icons/react/ShieldCheck';
export { SignOutIcon } from '@phosphor-icons/react/SignOut';
export { SlidersHorizontalIcon } from '@phosphor-icons/react/SlidersHorizontal';
export { SparkleIcon } from '@phosphor-icons/react/Sparkle';
export { SquaresFourIcon } from '@phosphor-icons/react/SquaresFour';
export { StarIcon } from '@phosphor-icons/react/Star';
export { TrashIcon } from '@phosphor-icons/react/Trash';
export { UploadSimpleIcon } from '@phosphor-icons/react/UploadSimple';
export { UserIcon } from '@phosphor-icons/react/User';
export { WarningCircleIcon } from '@phosphor-icons/react/WarningCircle';
export { XCircleIcon } from '@phosphor-icons/react/XCircle';
export { XIcon } from '@phosphor-icons/react/X';
