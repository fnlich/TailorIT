'use client';

import { useDraggable } from '@dnd-kit/core';
import { clsx } from 'clsx';
import { useCallback, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { addedLabel, type ApplicationSummary } from '@tailorit/shared';
import { Checkbox } from '@/components/ui/Checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/ContextMenu';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/Menu';
import { DotsThreeIcon, HeartIcon, MapPinIcon } from '@/components/ui/icons';
import { CompanyLogo } from '../CompanyLogo';
import { useLongPress } from '../hooks';
import { ApplicationMenuItems, type ApplicationActions } from './ApplicationMenu';

export interface CardHandlers extends ApplicationActions {
  onToggleFavorite: (application: ApplicationSummary) => void;
  onToggleSelected: (application: ApplicationSummary, selected: boolean) => void;
}

const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

/** The heart: outline and muted, or filled #08758c. */
export function FavoriteButton({
  application,
  onToggle,
  size = 'sm',
}: {
  application: ApplicationSummary;
  onToggle: (application: ApplicationSummary) => void;
  size?: 'xs' | 'sm';
}) {
  const label = application.favorite ? 'Remove from favorites' : 'Add to favorites';
  return (
    <IconButton
      label={label}
      size={size}
      aria-pressed={application.favorite}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(application);
      }}
      icon={
        application.favorite ? (
          <HeartIcon size={16} weight="fill" className="text-primary-ink" />
        ) : (
          <HeartIcon size={16} />
        )
      }
    />
  );
}

/** The card's face (also drawn in the drag overlay). */
export function CardBody({
  application,
  leading,
  actions,
}: {
  application: ApplicationSummary;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        {leading}
        <CompanyLogo name={application.companyName} logoUrl={application.logoUrl} size={32} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{application.companyName}</span>
        {actions}
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm leading-5 font-semibold break-words text-foreground">{application.title}</p>
      {application.location && (
        <p className="mt-[7px] flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <MapPinIcon size={13} className="shrink-0" />
          <span className="truncate">{application.location}</span>
        </p>
      )}
      <div className="mt-2.5 border-t border-divider-soft pt-2 text-xs leading-4 text-muted-foreground">
        {addedLabel(application.trackedOn)}
      </div>
    </>
  );
}

export const CARD_SURFACE = 'rounded-surface border bg-surface p-4 shadow-soft';

/**
 * A board card (Simplify): draggable between columns (8 px mouse, 180 ms touch hold, Space for the keyboard), opens
 * the application on click or Enter, and offers the actions menu from ⋯, a right-click or a 500 ms press.
 */
export function ApplicationCard({
  application,
  handlers,
  selected,
  selectMode,
  checked,
  draggingAny,
  consumeDragClick,
}: {
  application: ApplicationSummary;
  handlers: CardHandlers;
  /** Its detail sheet is open. */
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  /** Any card is being dragged (a long touch must not also open the context menu). */
  draggingAny: boolean;
  /** True once for the click that ends a drag. */
  consumeDragClick: () => boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
    data: { application },
    disabled: selectMode,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const longPress = useLongPress(openMenu);

  const activate = () => {
    if (selectMode) handlers.onToggleSelected(application, !checked);
    else handlers.onOpen(application);
  };

  return (
    <ContextMenu
      open={contextOpen}
      onOpenChange={(open) => {
        if (open && (draggingAny || selectMode)) return;
        setContextOpen(open);
      }}
    >
      <ContextMenuTrigger
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        {...longPress.handlers}
        render={<article />}
        aria-label={`${application.title}, ${application.companyName}`}
        aria-roledescription={selectMode ? 'selectable application' : 'draggable application'}
        // In select mode the card toggles its selection: not disabled, and its state is announced.
        aria-disabled={selectMode ? undefined : attributes['aria-disabled']}
        aria-describedby={selectMode ? undefined : attributes['aria-describedby']}
        aria-pressed={selectMode ? checked : attributes['aria-pressed']}
        data-application-card={application.id}
        onClick={() => {
          if (longPress.consumeClick() || consumeDragClick()) return;
          activate();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          // During a keyboard drag Enter drops the card (dnd-kit's own listener); it must not also open it.
          if (event.key === 'Enter' && event.target === event.currentTarget && !isDragging && !draggingAny) {
            event.preventDefault();
            activate();
            return;
          }
          if (event.key === 'Enter' && (isDragging || draggingAny)) return;
          listeners?.onKeyDown?.(event);
        }}
        className={clsx(
          CARD_SURFACE,
          'block w-full cursor-pointer text-left outline-offset-2 transition-colors duration-150 select-none',
          selected || checked ? 'border-primary-ink bg-primary/5' : 'border-border hover:bg-[#f6f6f6]',
          isDragging && 'opacity-40',
        )}
      >
        <CardBody
          application={application}
          leading={
            selectMode ? (
              <Checkbox
                checked={checked}
                stopPropagation
                aria-label={`Select ${application.title}`}
                onCheckedChange={(next) => handlers.onToggleSelected(application, next)}
              />
            ) : null
          }
          actions={
            <span className="flex items-center gap-0.5" onClick={stop} onKeyDown={stop} onMouseDown={stop} onPointerDown={stop}>
              <FavoriteButton application={application} onToggle={handlers.onToggleFavorite} />
              <Menu
                open={menuOpen}
                onOpenChange={(open) => {
                  if (!open) longPress.cancel();
                  setMenuOpen(open);
                }}
              >
                <MenuTrigger
                  render={
                    <IconButton
                      label="Application actions"
                      size="sm"
                      icon={<DotsThreeIcon size={16} weight="bold" className="text-foreground" />}
                    />
                  }
                />
                <MenuContent width="w-56" align="end">
                  <ApplicationMenuItems application={application} actions={handlers} />
                </MenuContent>
              </Menu>
            </span>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent width="w-56">
        <ApplicationMenuItems application={application} actions={handlers} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
