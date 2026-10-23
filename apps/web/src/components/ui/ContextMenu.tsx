'use client';

import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { MENU_SURFACE, Z_FLOATING } from './styles';

/*
 * A right-click (and long-press) menu over an area, e.g. a tracker card. Its rows are the Menu kit's rows:
 *   <ContextMenu>
 *     <ContextMenuTrigger render={<article …/>} />
 *     <ContextMenuContent><MenuItem …/></ContextMenuContent>
 *   </ContextMenu>
 */

export function ContextMenu(props: ComponentProps<typeof BaseContextMenu.Root>) {
  return <BaseContextMenu.Root {...props} />;
}

/** The area that opens the menu on right-click / long-press. Renders a div unless `render` says otherwise. */
export function ContextMenuTrigger(props: ComponentProps<typeof BaseContextMenu.Trigger>) {
  return <BaseContextMenu.Trigger {...props} />;
}

export function ContextMenuContent({
  children,
  width = 'w-60',
  className,
}: {
  children: ReactNode;
  width?: string;
  className?: string;
}) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner collisionPadding={8} className={clsx(Z_FLOATING, 'outline-none')}>
        <BaseContextMenu.Popup className={clsx(MENU_SURFACE, 'max-h-(--available-height) overflow-y-auto', width, className)}>
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}
