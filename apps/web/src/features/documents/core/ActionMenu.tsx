'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { clsx } from 'clsx';
import { useRef, type ReactElement } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { CaretDownIcon, DotsThreeVerticalIcon } from '@/components/ui/icons';
import { MenuContent, MenuItem, MenuSeparator } from '@/components/ui/Menu';
import type { ActionMenuItem } from './types';

export interface ActionMenuProps {
  items: readonly ActionMenuItem[];
  /** The trigger's accessible name: "Actions for {label}". */
  label: string;
  /**
   * "kebab": a ⋮ icon button (cards and list rows); "more": Simplify's "More ⌄" text button (table rows); or any
   * ref-forwarding element.
   */
  trigger?: 'kebab' | 'more' | ReactElement;
  align?: 'start' | 'end';
  /** Tailwind width class; Simplify's row menus are 176 px (w-44). */
  width?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A document's action menu, as an ARIA menu (Base UI): opening focuses the first action, arrows / Home / End move,
 * Escape closes and returns focus to the trigger, and it flips above the trigger near the bottom of the window.
 * Choosing an action closes the menu, returns focus to the trigger, and only then runs it, so a dialog the action
 * opens hands focus back to the trigger when it closes.
 */
export function ActionMenu({ items, label, trigger = 'kebab', align = 'end', width = 'w-44', disabled, className }: ActionMenuProps) {
  const pending = useRef<(() => void) | null>(null);

  const triggerElement =
    trigger === 'kebab' ? (
      <IconButton
        label={label}
        tooltip={false}
        size="sm"
        icon={<DotsThreeVerticalIcon size={20} weight="bold" />}
        className={className}
      />
    ) : trigger === 'more' ? (
      <button
        type="button"
        className={clsx(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-[13px] font-semibold whitespace-nowrap text-foreground',
          'transition-colors duration-150 hover:bg-hover data-popup-open:bg-hover disabled:opacity-50',
          className,
        )}
      >
        More
        {/* Read as "More actions for {name}": the visible word starts the accessible name. */}
        <span className="sr-only"> {label.charAt(0).toLowerCase() + label.slice(1)}</span>
        <CaretDownIcon size={14} className="transition-transform duration-150 in-data-popup-open:rotate-180" />
      </button>
    ) : (
      trigger
    );

  return (
    <BaseMenu.Root
      onOpenChangeComplete={(open) => {
        if (open) return;
        const run = pending.current;
        pending.current = null;
        // After Base UI has put focus back on the trigger.
        if (run) window.setTimeout(run, 0);
      }}
    >
      <BaseMenu.Trigger render={triggerElement} disabled={disabled} />
      <MenuContent align={align} width={width} aria-label={label}>
        {items.map((item) => (
          <ActionRow key={item.key} item={item} onChoose={(run) => (pending.current = run)} />
        ))}
      </MenuContent>
    </BaseMenu.Root>
  );
}

function ActionRow({ item, onChoose }: { item: ActionMenuItem; onChoose: (run: () => void) => void }) {
  return (
    <>
      {item.ruleBefore && <MenuSeparator />}
      <MenuItem
        icon={item.icon}
        hint={item.hint}
        tone={item.tone === 'danger' ? 'danger' : 'default'}
        disabled={item.disabled}
        title={item.title}
        onClick={() => onChoose(item.onSelect)}
      >
        {item.label}
      </MenuItem>
    </>
  );
}
