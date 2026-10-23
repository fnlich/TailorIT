'use client';

import { initialsOf, type Account } from '@tailorit/shared/auth';
import Link from 'next/link';
import { CaretDownIcon, GearSixIcon, ShieldCheckIcon, SignOutIcon } from '@/components/ui/icons';
import { LetterAvatar } from '@/components/ui/LetterAvatar';
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';

/**
 * The header's account control: Simplify's 40 px #3ec0de initials square and a caret, opening name/email, Settings,
 * Admin (administrators only) and Log out.
 */
export function AccountMenu({
  account,
  signingOut = false,
  onSignOut,
}: {
  account: Account;
  signingOut?: boolean;
  onSignOut: () => void;
}) {
  const displayName = account.name.trim() || account.email;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account menu for ${displayName}`}
        className="group flex items-center gap-[11px] rounded-control outline-offset-4"
      >
        <LetterAvatar letters={initialsOf(account.name, account.email)} size={40} tone="brand" />
        <CaretDownIcon
          size={16}
          className="text-muted-foreground transition-transform duration-150 group-data-popup-open:rotate-180 max-sm:hidden"
        />
      </MenuTrigger>
      <MenuContent align="end" width="w-64" aria-label="Account">
        <div className="flex flex-col px-1.5 pt-1 pb-2">
          <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
          {account.name.trim() && <span className="truncate text-xs text-muted-foreground">{account.email}</span>}
        </div>
        <MenuSeparator />
        <MenuLinkItem href="/settings" render={<Link href="/settings" />} icon={<GearSixIcon size={16} />}>
          Settings
        </MenuLinkItem>
        {account.role === 'admin' && (
          <MenuLinkItem href="/settings/admin" render={<Link href="/settings/admin" />} icon={<ShieldCheckIcon size={16} />}>
            Admin
          </MenuLinkItem>
        )}
        <MenuSeparator />
        <MenuItem
          tone="danger"
          icon={<SignOutIcon size={16} />}
          closeOnClick={false}
          disabled={signingOut}
          onClick={() => onSignOut()}
        >
          {signingOut ? 'Signing out...' : 'Log out'}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
