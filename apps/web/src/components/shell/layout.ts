/** Horizontal page gutter shared by the header and page bodies (Simplify: 35 px on desktop). */
export const PAGE_GUTTER = 'px-4 sm:px-6 lg:px-[35px]';

/** The header's main destinations. */
export const APP_NAV = [
  { href: '/jobs', label: 'Jobs' },
  { href: '/tracker', label: 'Job Tracker' },
  { href: '/documents', label: 'Documents' },
] as const;

/** Whether `pathname` is inside the section that starts at `href`. */
export function isSectionActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
