/*
 * Class strings shared by the kit's floating surfaces (Simplify's menus: white at 96% with a blur, 1px outline at 6%
 * black, `0 10px 15px -3px #0000000f`, radius 10, rows radius 6 with a 6% black highlight).
 */

export const POPUP_MOTION =
  'origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out-soft ' +
  'data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0';

export const MENU_SURFACE =
  'rounded-menu bg-white/[0.96] p-1.5 text-sm text-foreground shadow-menu outline outline-1 outline-black/[0.06] ' +
  'backdrop-blur-md focus-visible:outline-black/[0.06] ' +
  POPUP_MOTION;

/**
 * A menu row without colours: the popup sets the text colour and each row adds its highlight
 * (MENU_ROW = the usual one). Kept apart because the kit merges classes with clsx only, so two utilities for the
 * same property must never be combined.
 */
export const MENU_ROW_BASE =
  'flex min-h-8 w-full cursor-default select-none items-center gap-2.5 rounded-menu-row px-1.5 py-1.5 text-left text-sm leading-5 ' +
  'outline-none data-disabled:cursor-not-allowed data-disabled:opacity-45 [&_svg]:shrink-0';

export const MENU_ROW = `${MENU_ROW_BASE} data-highlighted:bg-hover`;

export const MENU_GROUP_LABEL = 'px-1.5 pt-1.5 pb-1 text-xs leading-4 font-medium text-muted-foreground select-none';

export const MENU_SEPARATOR = 'mx-1.5 my-1.5 h-px bg-border';

/** Popovers (date picker, filter panels): radius 14 and the popover shadow. */
export const POPOVER_SURFACE =
  'rounded-popup bg-surface text-sm text-foreground shadow-popover outline outline-1 outline-black/[0.06] ' + POPUP_MOTION;

/** Stacking order: sticky header 30, dialogs 50, floating layers (menus, popovers, selects) 60, tooltips 70. */
export const Z_FLOATING = 'z-[60]';
