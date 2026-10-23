'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import type { TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { PencilSimpleIcon, UploadSimpleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { resumeEditorHref } from '../api';
import { PDF_ACCEPT, UPLOAD_MAX_MB, chooseFile } from '../files';
import { useResumeImport } from '../useResumeImport';

/**
 * "Import your existing resume", asked when a new resume opens on the template just chosen: Import resume (a PDF the
 * AI reads into a new resume, saved as soon as it is read, then opened here on the chosen template and layout) or
 * Start from blank. Start from blank, Close, Escape and a press outside all leave the empty editor; while a file is
 * being read nothing closes it.
 */
export function ImportStartDialog({
  open,
  templateId,
  layout,
  templateName,
  onStartBlank,
}: {
  open: boolean;
  /** '' when started without one. */
  templateId: string;
  layout: TechnicalSkillsLayout;
  templateName: string;
  onStartBlank: () => void;
}) {
  const router = useRouter();
  // The import makes the new resume on the template and layout chosen a step ago (passed with the upload).
  const onImported = useCallback((resumeId: string) => router.replace(resumeEditorHref(resumeId)), [router]);
  const importer = useResumeImport(onImported);
  const working = importer.working;

  const importResume = async () => {
    const file = await chooseFile(PDF_ACCEPT);
    if (file) await importer.importPdf(file, { templateId: templateId || undefined, layout });
  };

  const busyLine =
    importer.phase === 'uploading'
      ? 'Uploading your resume...'
      : importer.phase === 'opening'
        ? 'Opening your new resume...'
        : (importer.progress ?? 'Reading your resume. This can take a minute.');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !working) onStartBlank();
      }}
    >
      <DialogContent
        size="lg"
        title="Import your existing resume"
        description="Start faster by prefilling your resume content."
        showClose={!working}
      >
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button size="lg" icon={<UploadSimpleIcon size={16} />} onClick={() => void importResume()} disabled={working} fullWidth>
            Import resume
          </Button>
          <Button size="lg" variant="outline" icon={<PencilSimpleIcon size={16} />} onClick={onStartBlank} disabled={working} fullWidth>
            Start from blank
          </Button>
        </div>
        {working ? (
          <div className="mt-4 flex items-center gap-2.5 rounded-control bg-surface-low px-3.5 py-3">
            <Spinner size={16} label={busyLine} />
          </div>
        ) : (
          <p className="mt-4 text-[13px] leading-5 text-muted-foreground">
            A resume PDF under {UPLOAD_MAX_MB} MB. An AI reads it into a new resume on {templateName}, saved as soon as it is
            read, and the editor opens on it for you to look over.
          </p>
        )}
        {importer.error && (
          <Notice tone="error" className="mt-4">
            {importer.error}
          </Notice>
        )}
      </DialogContent>
    </Dialog>
  );
}
