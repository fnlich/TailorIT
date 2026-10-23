'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/lib/auth';
import { AccountMenu } from './AccountMenu';
import { APP_NAV, PAGE_GUTTER, isSectionActive } from './layout';
import { Logo, LogoMark } from './Logo';

/**
 * The app's top bar (Simplify's header): white, 62 px plus a #e8e8e8 bottom border; logo, then Jobs | Job Tracker |
 * Documents; the active item is a full-height #e8e8e8 block with a 2 px #191919 bar on the bottom edge; the
 * account square at the right. No buttons for features TailorIT does not have.
 */
export function AppHeader({
  className,
  activePath,
}: {
  className?: string;
  /** Overrides the current path for the active item (dev kit, tests). */
  activePath?: string;
}) {
  const currentPath = usePathname();
  const pathname = activePath ?? currentPath;
  const { account, signingOut, signOut } = useAuth();

  return (
    <header
      data-app-header
      className={clsx('sticky top-0 z-30 h-[63px] shrink-0 border-b border-border bg-surface', className)}
    >
      <div className={clsx('flex h-full items-stretch', PAGE_GUTTER)}>
        <Link
          href="/jobs"
          aria-label="TailorIT, go to Jobs"
          className="flex shrink-0 items-center rounded-control outline-offset-4"
        >
          <Logo className="max-sm:hidden" />
          <LogoMark className="sm:hidden" />
        </Link>

        <nav aria-label="Main" className="-mb-px ml-3 flex min-w-0 items-stretch gap-1 overflow-x-auto sm:ml-[26px]">
          {APP_NAV.map((item) => {
            const active = isSectionActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-active={active ? '' : undefined}
                className={clsx(
                  'relative flex shrink-0 items-center rounded-md px-2 text-base whitespace-nowrap transition-colors duration-150 sm:px-3',
                  'focus-visible:outline-offset-[-2px]',
                  active
                    ? 'bg-muted text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:content-[""]'
                    : 'text-muted-foreground hover:bg-[#f5f5f5] hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center pl-2 sm:pl-4">
          {account ? (
            <AccountMenu account={account} signingOut={signingOut} onSignOut={() => void signOut()} />
          ) : (
            <span className="flex items-center gap-[11px]" aria-hidden="true">
              <Skeleton className="size-10" rounded="control" />
              <span className="w-4 max-sm:hidden" />
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
