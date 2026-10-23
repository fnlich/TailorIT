'use client';

import { ArrowsLeftRightIcon } from '@phosphor-icons/react/ArrowsLeftRight';
import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/ArrowsOutSimple';
import { APPLICATION_STATUSES, STATUS_INFO, type ApplicationStatus, type ApplicationSummary } from '@tailorit/shared';
import {
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
} from '@/components/ui/Menu';
import { ArchiveIcon, ArrowCounterClockwiseIcon, ArrowSquareOutIcon } from '@/components/ui/icons';
import { StatusIcon } from '../status';

export interface ApplicationActions {
  onOpen: (application: ApplicationSummary) => void;
  onMove: (application: ApplicationSummary, status: ApplicationStatus) => void;
  onArchive: (application: ApplicationSummary) => void;
  onRestore: (application: ApplicationSummary) => void;
}

/**
 * Simplify's card menu (the ⋯ button, a right-click and a long press): Open application, View job posting, Move to ›
 * (every status, the current one disabled), Archive / Restore application.
 */
export function ApplicationMenuItems({ application, actions }: { application: ApplicationSummary; actions: ApplicationActions }) {
  return (
    <>
      <MenuItem icon={<ArrowsOutSimpleIcon size={16} />} onClick={() => actions.onOpen(application)}>
        Open application
      </MenuItem>
      {application.postingUrl && (
        <MenuLinkItem
          href={application.postingUrl}
          icon={<ArrowSquareOutIcon size={16} />}
          render={<a href={application.postingUrl} target="_blank" rel="noopener noreferrer" />}
        >
          View job posting
        </MenuLinkItem>
      )}
      <MenuSeparator />
      <MenuSub label="Move to" icon={<ArrowsLeftRightIcon size={16} />}>
        <MenuSubContent width="w-52">
          <MenuRadioGroup
            value={String(application.currentStatus)}
            onValueChange={(value) => actions.onMove(application, Number(value) as ApplicationStatus)}
          >
            {APPLICATION_STATUSES.map((status) => (
              <MenuRadioItem
                key={status}
                value={String(status)}
                icon={<StatusIcon status={status} size={16} />}
                disabled={status === application.currentStatus}
                closeOnClick
              >
                {STATUS_INFO[status].label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubContent>
      </MenuSub>
      <MenuSeparator />
      {application.archivedAt ? (
        <MenuItem icon={<ArrowCounterClockwiseIcon size={16} />} onClick={() => actions.onRestore(application)}>
          Restore application
        </MenuItem>
      ) : (
        <MenuItem icon={<ArchiveIcon size={16} />} onClick={() => actions.onArchive(application)}>
          Archive application
        </MenuItem>
      )}
    </>
  );
}
