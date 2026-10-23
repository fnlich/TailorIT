'use client';

import { BracketsCurlyIcon } from '@phosphor-icons/react/BracketsCurly';
import { FileDocIcon } from '@phosphor-icons/react/FileDoc';
import { FilePdfIcon } from '@phosphor-icons/react/FilePdf';
import { PencilLineIcon } from '@phosphor-icons/react/PencilLine';
import { MAX_RESUME_TITLE_LENGTH, resumeExportFileName, type ResumeSummary } from '@tailorit/shared/resume';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyIcon, DownloadSimpleIcon, EyeIcon, PencilSimpleIcon, SparkleIcon, StarIcon, TrashIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  deleteResume,
  duplicateResume,
  renameResume,
  resumeEditorHref,
  resumeExportHref,
  resumeFileHref,
  setDefaultResume,
  startEditableCopy,
} from '../../resume-editor/api';
import { dropResumesFromList, invalidateResumes, markDefaultInList, putResumeInList } from '../../resume-editor/cache';
import { downloadFrom } from '../../resume-editor/files';
import { RenameDialog, focusDocument, neighbourOf, type ActionMenuItem } from '../core';
import { menuKeysFor, type ResumeMenuKey } from './list';

/** Opens an uploaded resume's file in a new tab (a PDF shows in the browser; a Word file downloads). */
export function openResumeFile(id: string): void {
  window.open(resumeFileHref(id, true), '_blank', 'noopener');
}

/**
 * What a resume's ⋮ does (free_tailor's menu, for TailorIT): Edit or View, Rename ("Change resume name"), Duplicate,
 * Set as default, the downloads, Make editable copy and Delete (a styled confirmation). `itemsFor(resume)` is the
 * menu; `dialogs` is drawn once by the tab. After a delete, focus moves to the neighbouring card or row.
 */
export function useResumeActions({
  visibleIds,
  onTaskStarted,
}: {
  /** The ids as displayed (after the filter and the search), for where focus goes after a delete. */
  visibleIds: readonly string[];
  onTaskStarted: (task: { taskId: string; label: string }) => void;
}): { itemsFor: (resume: ResumeSummary) => ActionMenuItem[]; dialogs: ReactNode } {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { setAccount } = useAuth();
  const [renaming, setRenaming] = useState<ResumeSummary | null>(null);
  const [deleting, setDeleting] = useState<ResumeSummary | null>(null);
  const inFlight = useRef(new Set<string>());

  const refresh = () => invalidateResumes(queryClient);

  /** Runs one action per resume at a time; a failure becomes a toast with the server's sentence. */
  const attempt = async (resume: ResumeSummary, what: string, fallback: string, work: () => Promise<void>) => {
    const key = `${what}:${resume.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } catch (caught) {
      toast.error(fallback, userMessage(caught, 'Please try again.'));
      // A resume gone from under the page: read the list again so its card goes too.
      void refresh();
    } finally {
      inFlight.current.delete(key);
    }
  };

  const setDefault = (resume: ResumeSummary) =>
    attempt(resume, 'default', 'Could not set the default resume', async () => {
      const account = await setDefaultResume(resume.id);
      if (account) setAccount(account);
      markDefaultInList(queryClient, resume.id);
      void refresh();
      toast.success(`${resume.label} is now your default resume`);
    });

  const duplicate = (resume: ResumeSummary) =>
    attempt(resume, 'duplicate', 'Could not duplicate the resume', async () => {
      const saved = await duplicateResume(resume.id);
      putResumeInList(queryClient, saved.summary);
      void refresh();
      toast.success(`Duplicated ${resume.label}`);
    });

  const download = (resume: ResumeSummary, format: 'pdf' | 'docx') =>
    attempt(resume, format, `Could not download the ${format === 'pdf' ? 'PDF' : 'Word file'}`, async () => {
      toast.info(format === 'pdf' ? 'Preparing your PDF...' : 'Preparing your Word file...');
      await downloadFrom(resumeExportHref(resume.id, format), resumeExportFileName(resume.label, format));
    });

  // The server writes the file Import JSON takes back (GET /api/resumes/:id/export?format=json).
  const downloadJson = (resume: ResumeSummary) =>
    attempt(resume, 'json', 'Could not download the JSON file', async () => {
      await downloadFrom(resumeExportHref(resume.id, 'json'), resumeExportFileName(resume.label));
    });

  const downloadFile = (resume: ResumeSummary) =>
    attempt(resume, 'file', 'Could not download the file', async () => {
      await downloadFrom(resumeFileHref(resume.id), resumeExportFileName(resume.label, resume.fileKind ?? 'pdf'));
    });

  const makeCopy = (resume: ResumeSummary) =>
    attempt(resume, 'copy', 'Could not start the editable copy', async () => {
      const taskId = await startEditableCopy(resume.id);
      onTaskStarted({ taskId, label: resume.label });
    });

  const fileLabel = (resume: ResumeSummary) =>
    resume.fileKind === 'docx' ? 'Download Word' : resume.fileKind === 'pdf' ? 'Download PDF' : 'Download file';

  const build: Record<ResumeMenuKey, (resume: ResumeSummary) => ActionMenuItem> = {
    edit: (resume) => ({ key: 'edit', label: 'Edit', icon: <PencilSimpleIcon size={16} />, onSelect: () => router.push(resumeEditorHref(resume.id)) }),
    view: (resume) => ({ key: 'view', label: 'View', icon: <EyeIcon size={16} />, onSelect: () => openResumeFile(resume.id) }),
    rename: (resume) => ({ key: 'rename', label: 'Rename', icon: <PencilLineIcon size={16} />, onSelect: () => setRenaming(resume) }),
    duplicate: (resume) => ({ key: 'duplicate', label: 'Duplicate', icon: <CopyIcon size={16} />, onSelect: () => void duplicate(resume) }),
    default: (resume) => ({
      key: 'default',
      label: 'Set as default',
      icon: <StarIcon size={16} />,
      disabled: resume.isDefault,
      title: resume.isDefault ? 'Already your default resume' : 'Used for job matches and cover letters',
      onSelect: () => void setDefault(resume),
    }),
    pdf: (resume) => ({ key: 'pdf', label: 'Download PDF', icon: <FilePdfIcon size={16} />, onSelect: () => void download(resume, 'pdf') }),
    docx: (resume) => ({
      key: 'docx',
      label: 'Download Word',
      title: 'A simple layout, not the template',
      icon: <FileDocIcon size={16} />,
      onSelect: () => void download(resume, 'docx'),
    }),
    json: (resume) => ({
      key: 'json',
      label: 'Download JSON',
      title: 'The resume as a file that Import takes back',
      icon: <BracketsCurlyIcon size={16} />,
      onSelect: () => void downloadJson(resume),
    }),
    file: (resume) => ({ key: 'file', label: fileLabel(resume), icon: <DownloadSimpleIcon size={16} />, onSelect: () => void downloadFile(resume) }),
    copy: (resume) => ({
      key: 'copy',
      label: 'Make editable copy',
      title: 'An AI reads the file into a resume you can edit',
      icon: <SparkleIcon size={16} />,
      onSelect: () => void makeCopy(resume),
    }),
    delete: (resume) => ({
      key: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={16} />,
      tone: 'danger',
      ruleBefore: true,
      onSelect: () => setDeleting(resume),
    }),
  };

  const itemsFor = (resume: ResumeSummary) => menuKeysFor(resume).map((key) => build[key](resume));

  const dialogs = (
    <>
      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Change resume name"
        description="The name shown in your documents list."
        label="Resume name"
        initialValue={renaming?.label ?? ''}
        maxLength={MAX_RESUME_TITLE_LENGTH}
        onSubmit={async (name) => {
          if (!renaming) return;
          const saved = await renameResume(renaming.id, name);
          putResumeInList(queryClient, saved.summary);
          void refresh();
          toast.success('Resume renamed');
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete Resume"
        description="Are you sure you want to delete this resume? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          if (!deleting) return;
          const next = neighbourOf(visibleIds, [deleting.id]);
          const { defaultResumeId } = await deleteResume(deleting.id);
          dropResumesFromList(queryClient, [deleting.id], defaultResumeId);
          void refresh();
          toast.success(`Deleted ${deleting.label}`);
          // After the dialog has closed and handed focus back to a trigger that is gone: the neighbour, else New. Only
          // when focus was lost: someone already on another control (a menu opened meanwhile) is left there.
          window.setTimeout(() => {
            const active = document.activeElement;
            if (active && active !== document.body && active.isConnected) return;
            focusDocument('resume', next);
          }, 320);
        }}
      >
        {deleting?.isDefault ? <p className="text-muted-foreground">It is your default resume: the newest other resume becomes the default.</p> : null}
      </ConfirmDialog>
    </>
  );

  return { itemsFor, dialogs };
}
