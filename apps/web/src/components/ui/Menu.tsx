'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { clsx } from 'clsx';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { CaretRightIcon, CheckIcon } from './icons';
import { MENU_GROUP_LABEL, MENU_ROW, MENU_ROW_BASE, MENU_SEPARATOR, MENU_SURFACE, Z_FLOATING } from './styles';

/*
 * Simplify's dropdown menu (the tracker "Options" menu, row "More ⌄", the account menu): 240 px wide by default,
 * radius 10, rows 32 px with radius 6, small muted group headings, separators, submenus with ›, checkbox and
 * radio rows. Keyboard: arrows, Home/End, typeahead, Escape (Base UI).
 *
 *   <Menu>
 *     <MenuTrigger render={<FilterPill label="Options" />} />
 *     <MenuContent>
 *       <MenuGroup label="Filters">…</MenuGroup>
 *       <MenuSeparator />
 *       <MenuItem icon={<TrashIcon />} tone="danger" onClick={…}>Delete</MenuItem>
 *     </MenuContent>
 *   </Menu>
 */

export type MenuProps = ComponentProps<typeof BaseMenu.Root>;

export function Menu(props: MenuProps) {
  return <BaseMenu.Root {...props} />;
}

/** The button that opens the menu. Pass `render={<Button …/>}` (or any ref-forwarding element) to style it. */
export function MenuTrigger(props: ComponentProps<typeof BaseMenu.Trigger>) {
  return <BaseMenu.Trigger {...props} />;
}

export interface MenuContentProps {
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  alignOffset?: number;
  /** Tailwind width class; Simplify's menus are w-60 (240 px), row menus w-44 (176 px). */
  width?: string;
  className?: string;
  'aria-label'?: string;
}

export function MenuContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  alignOffset = 0,
  width = 'w-60',
  className,
  ...aria
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={8}
        className={clsx(Z_FLOATING, 'outline-none')}
      >
        <BaseMenu.Popup
          aria-label={aria['aria-label']}
          className={clsx(MENU_SURFACE, 'max-h-(--available-height) max-w-[calc(100vw-1rem)] overflow-y-auto', width, className)}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export interface MenuItemProps extends Omit<ComponentProps<typeof BaseMenu.Item>, 'className' | 'children'> {
  children: ReactNode;
  icon?: ReactNode;
  /** A second, muted line under the label. */
  hint?: ReactNode;
  /** Right-aligned text (a count, a shortcut). */
  trailing?: ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
}

function RowContent({ icon, children, hint, trailing, tone }: Pick<MenuItemProps, 'icon' | 'children' | 'hint' | 'trailing' | 'tone'>) {
  return (
    <>
      {icon && (
        <span className={clsx('flex', tone === 'danger' ? 'text-current' : 'text-muted-foreground')} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {hint && <span className="text-xs leading-4 whitespace-normal text-muted-foreground">{hint}</span>}
      </span>
      {trailing && <span className="ml-auto pl-2 text-xs text-muted-foreground">{trailing}</span>}
    </>
  );
}

export function MenuItem({ children, icon, hint, trailing, tone = 'default', className, ...rest }: MenuItemProps) {
  return (
    <BaseMenu.Item
      {...rest}
      className={clsx(
        tone === 'danger' ? `${MENU_ROW_BASE} text-[#d93636] data-highlighted:bg-destructive-container` : MENU_ROW,
        className,
      )}
    >
      <RowContent icon={icon} hint={hint} trailing={trailing} tone={tone}>
        {children}
      </RowContent>
    </BaseMenu.Item>
  );
}

export interface MenuLinkItemProps {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  /** Render through a router link, e.g. `<Link href="…" />`. */
  render?: ReactElement;
  className?: string;
}

/** A row that navigates. Pass `render={<Link href={href} />}` for client-side navigation. */
export function MenuLinkItem({ href, children, icon, hint, render, className }: MenuLinkItemProps) {
  return (
    <BaseMenu.LinkItem href={href} render={render} closeOnClick className={clsx(MENU_ROW, className)}>
      <RowContent icon={icon} hint={hint}>
        {children}
      </RowContent>
    </BaseMenu.LinkItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <BaseMenu.Separator className={clsx(MENU_SEPARATOR, className)} />;
}

/** A labelled section ("Filters", "View options", "Actions"). */
export function MenuGroup({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <BaseMenu.Group className={className}>
      {label && <BaseMenu.GroupLabel className={MENU_GROUP_LABEL}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.Group>
  );
}

export interface MenuCheckboxItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Close the menu when toggled (default: stays open, like Simplify's "Show only favorites"). */
  closeOnClick?: boolean;
  /** "box" draws a checkbox at the right (Simplify); "check" a tick at the left. */
  indicator?: 'box' | 'check';
  className?: string;
}

export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  icon,
  disabled,
  closeOnClick = false,
  indicator = 'box',
  className,
}: MenuCheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      closeOnClick={closeOnClick}
      className={clsx(MENU_ROW, className)}
    >
      {indicator === 'check' && (
        <span className="flex size-4 items-center justify-center text-primary-ink">
          <BaseMenu.CheckboxItemIndicator>
            <CheckIcon size={14} weight="bold" />
          </BaseMenu.CheckboxItemIndicator>
        </span>
      )}
      {icon && <span className="flex text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {indicator === 'box' && (
        <span
          aria-hidden="true"
          className={clsx(
            'ml-auto inline-flex size-[18px] items-center justify-center rounded-[5px] border text-white shadow-control',
            checked ? 'border-primary bg-primary' : 'border-checkbox bg-surface',
          )}
        >
          {checked && <CheckIcon size={12} weight="bold" />}
        </span>
      )}
    </BaseMenu.CheckboxItem>
  );
}

export function MenuRadioGroup<V extends string>({
  value,
  onValueChange,
  label,
  children,
}: {
  value: V;
  onValueChange: (value: V) => void;
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BaseMenu.RadioGroup value={value} onValueChange={(next) => onValueChange(next as V)}>
      {label && <BaseMenu.GroupLabel className={MENU_GROUP_LABEL}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.RadioGroup>
  );
}

export function MenuRadioItem({
  value,
  children,
  icon,
  disabled,
  closeOnClick = false,
  className,
}: {
  value: string;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  closeOnClick?: boolean;
  className?: string;
}) {
  return (
    <BaseMenu.RadioItem value={value} disabled={disabled} closeOnClick={closeOnClick} className={clsx(MENU_ROW, className)}>
      <span className="flex size-4 items-center justify-center text-primary-ink">
        <BaseMenu.RadioItemIndicator>
          <CheckIcon size={14} weight="bold" />
        </BaseMenu.RadioItemIndicator>
      </span>
      {icon && <span className="flex text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </BaseMenu.RadioItem>
  );
}

/** A row that opens a nested menu (› at the right). Put a MenuSubContent inside. */
export function MenuSub({
  label,
  icon,
  trailing,
  disabled,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger disabled={disabled} className={clsx(MENU_ROW, 'data-popup-open:bg-hover')}>
        {icon && <span className="flex text-muted-foreground">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing && <span className="text-xs text-muted-foreground">{trailing}</span>}
        <CaretRightIcon size={14} className="ml-auto text-muted-foreground" />
      </BaseMenu.SubmenuTrigger>
      {children}
    </BaseMenu.SubmenuRoot>
  );
}

export function MenuSubContent({ children, width = 'w-56', className }: { children: ReactNode; width?: string; className?: string }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={4} alignOffset={-6} collisionPadding={8} className={clsx(Z_FLOATING, 'outline-none')}>
        <BaseMenu.Popup className={clsx(MENU_SURFACE, 'max-h-(--available-height) overflow-y-auto', width, className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}
