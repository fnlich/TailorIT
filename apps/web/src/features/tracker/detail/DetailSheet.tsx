'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { STATUS, type ApplicationDetail } from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BACKDROP } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Notice } from '@/components/ui/Notice';
import { TabPanel } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { ArchiveIcon, ArrowCounterClockwiseIcon, HeartIcon, PencilSimpleIcon, TrashIcon, XIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import { CompanyLogo } from '../CompanyLogo';
import { invalidateApplications, trackerApi, trackerKeys, useApplication, useMoveStatus, useToggleFavorite } from '../data';
import { DocumentsTab } from './DocumentsTab';
import { NotesPanel } from './NotesPanel';
import { OverviewTab } from './OverviewTab';
import { QuestionsTab } from './QuestionsTab';
import { ResumeScoreTab } from './ResumeScoreTab';
import { StatusPanel } from './StatusPanel';

type DetailTab = 'overview' | 'documents' | 'score' | 'questions';

const TABS: Array<{ value: DetailTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'documents', label: 'Documents' },
  { value: 'score', label: 'Resume Score' },
  { value: 'questions', label: 'Questions' },
];

function DetailBody({
  application,
  initialEdit,
  onEditConsumed,
  onClose,
}: {
  application: ApplicationDetail;
  initialEdit: boolean;
  onEditConsumed: () => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [editing, setEditing] = useState(initialEdit);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askApplied, setAskApplied] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const favorite = useToggleFavorite();
  const move = useMoveStatus();

  const canApply = application.currentStatus === STATUS.saved && Boolean(application.postingUrl);

  // "?edit=1" opens the form once; a reload afterwards shows the read view.
  useEffect(() => {
    if (initialEdit) onEditConsumed();
  }, [initialEdit, onEditConsumed]);

  const toggleArchive = async () => {
    setArchiving(true);
    try {
      const saved = application.archivedAt ? await trackerApi.restore(application.id) : await trackerApi.archive(application.id);
      client.setQueryData(trackerKeys.detail(application.id), saved);
      toast.success(saved.archivedAt ? 'Application archived' : 'Application restored');
      void invalidateApplications(client);
    } catch (error) {
      toast.error(userMessage(error, "We couldn't update the application. Please try again."));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <header className="flex flex-wrap items-start gap-4 border-b border-border px-6 py-5">
        <CompanyLogo name={application.companyName} logoUrl={application.logoUrl} size={64} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-center">
          <div className="flex min-w-0 items-center gap-1">
            <BaseDialog.Title className="min-w-0 truncate text-xl leading-7 font-medium text-foreground">{application.title}</BaseDialog.Title>
            <IconButton
              label="Edit job posting"
              size="sm"
              icon={<PencilSimpleIcon size={16} />}
              onClick={() => {
                setTab('overview');
                setEditing(true);
              }}
            />
          </div>
          <BaseDialog.Description className="truncate text-sm text-muted-foreground">{application.companyName}</BaseDialog.Description>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canApply && (
            <Button
              onClick={() => {
                window.open(application.postingUrl, '_blank', 'noopener,noreferrer');
                setAskApplied(true);
              }}
            >
              Apply
            </Button>
          )}
          <Button
            variant="outline"
            aria-pressed={application.favorite}
            icon={
              application.favorite ? (
                <HeartIcon size={16} weight="fill" className="text-primary-ink" />
              ) : (
                <HeartIcon size={16} />
              )
            }
            onClick={() => favorite.mutate({ id: application.id, favorite: !application.favorite })}
          >
            {application.favorite ? 'Unfavorite' : 'Favorite'}
          </Button>
          <Button
            variant="outline"
            loading={archiving}
            icon={application.archivedAt ? <ArrowCounterClockwiseIcon size={16} /> : <ArchiveIcon size={16} />}
            onClick={() => void toggleArchive()}
          >
            {application.archivedAt ? 'Unarchive' : 'Archive'}
          </Button>
          <Button variant="destructive-outline" icon={<TrashIcon size={16} />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <BaseDialog.Close render={<IconButton label="Close" icon={<XIcon size={18} />} tooltip={false} />} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <UnderlineTabs aria-label="Application details" size="md" value={tab} onValueChange={setTab} items={TABS} className="min-w-0">
            {/* Kept mounted so an unsaved Edit Job Posting survives a look at another tab. */}
            <TabPanel value="overview" className="pt-5" keepMounted>
              <OverviewTab application={application} editing={editing} onEditingChange={setEditing} />
            </TabPanel>
            <TabPanel value="documents" className="pt-5">
              <DocumentsTab application={application} />
            </TabPanel>
            <TabPanel value="score" className="pt-5">
              <ResumeScoreTab application={application} onDocuments={() => setTab('documents')} />
            </TabPanel>
            <TabPanel value="questions" className="pt-5">
              <QuestionsTab application={application} />
            </TabPanel>
          </UnderlineTabs>
          <aside className="flex flex-col gap-4" aria-label="Status and notes">
            <StatusPanel application={application} />
            <NotesPanel key={application.id} application={application} />
          </aside>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Application"
        description="Are you sure you want to delete this application? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          await trackerApi.remove(application.id);
          void invalidateApplications(client);
          toast.success('Application deleted');
          onClose();
        }}
      />
      <ConfirmDialog
        open={askApplied}
        onOpenChange={setAskApplied}
        title="Did you apply?"
        description={`Let us know if you finished applying to ${application.title} at ${application.companyName}, and we'll move it to Applied.`}
        confirmLabel="Yes, I applied"
        cancelLabel="Not yet"
        tone="primary"
        onConfirm={async () => {
          await move.mutateAsync({ id: application.id, status: STATUS.applied, from: application.currentStatus });
        }}
      />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-4 border-b border-border px-6 py-5">
        <Skeleton className="size-16" rounded="control" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-64 w-full" rounded="surface" />
        <Skeleton className="h-64 w-full" rounded="surface" />
      </div>
    </div>
  );
}

/**
 * Simplify's application detail: a right sheet (max-w-7xl) with the header actions, the Overview / Documents /
 * Resume Score / Questions tabs, and the status timeline and notes on the right.
 */
export function DetailSheet({
  id,
  open,
  initialEdit,
  onEditConsumed,
  onClose,
}: {
  /** The application to show (kept while the sheet slides out). */
  id: string | null;
  open: boolean;
  initialEdit: boolean;
  /** The edit-mode flag has been read (the page drops it from the URL). */
  onEditConsumed: () => void;
  onClose: () => void;
}) {
  const detail = useApplication(id, open);
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Popup
          aria-label={detail.data ? undefined : 'Application'}
          className={clsx(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface text-foreground shadow-dialog outline-none sm:max-w-7xl',
            'transition-transform duration-300 ease-out-soft data-starting-style:translate-x-full data-ending-style:translate-x-full',
          )}
        >
          {detail.data ? (
            <DetailBody
              key={detail.data.id}
              application={detail.data}
              initialEdit={initialEdit}
              onEditConsumed={onEditConsumed}
              onClose={onClose}
            />
          ) : detail.isError ? (
            <div className="flex flex-col gap-4 p-6">
              <div className="flex items-center justify-between">
                <BaseDialog.Title className="text-lg font-semibold">Application</BaseDialog.Title>
                <BaseDialog.Close render={<IconButton label="Close" icon={<XIcon size={18} />} tooltip={false} />} />
              </div>
              <Notice tone="error">{userMessage(detail.error, "We couldn't open that application. It may have been deleted.")}</Notice>
            </div>
          ) : (
            <DetailSkeleton />
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
