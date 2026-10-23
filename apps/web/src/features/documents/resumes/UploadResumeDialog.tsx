'use client';

import { FileArrowUpIcon } from '@phosphor-icons/react/FileArrowUp';
import type { ResumeSummary } from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { FileTextIcon, XIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { userMessage } from '@/lib/api';
import { uploadResume } from '../../resume-editor/api';
import { RESUME_FILE_ACCEPT, UPLOAD_MAX_MB, fileSizeRefusal } from '../../resume-editor/files';
import { uploadTitle } from './list';

export interface UploadedResume {
  id: string | null;
  label: string;
  /** The stored upload as the list shows it. */
  summary: ResumeSummary | null;
  /** The AI import when "Make an editable copy with AI" was ticked. */
  taskId: string | null;
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Simplify's "Upload Resume": a name for the documents list, the file (PDF, DOC or DOCX up to 5 MB; dropped or
 * chosen) and "Make an editable copy with AI", which also has the AI read the file into a resume this editor writes.
 * The server's own sentence is shown when it refuses a file (a .doc it cannot read, a file too large).
 */
export function UploadResumeDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (result: UploadedResume) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <UploadForm onClose={() => onOpenChange(false)} onUploaded={onUploaded} />}
    </Dialog>
  );
}

function UploadForm({ onClose, onUploaded }: { onClose: () => void; onUploaded: (result: UploadedResume) => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choose = (picked: File | null | undefined) => {
    setError(null);
    if (!picked) return;
    const refusal = fileSizeRefusal(picked);
    if (refusal) {
      setError(refusal);
      return;
    }
    setFile(picked);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) choose(event.dataTransfer.files?.[0]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || busy) {
      if (!file) setError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    const label = uploadTitle(name, file.name);
    try {
      const answer = await uploadResume(file, { title: label, parse });
      onUploaded({ id: answer.resume?.id ?? null, label: answer.resume?.label ?? label, summary: answer.resume, taskId: answer.taskId });
      onClose();
    } catch (caught) {
      setError(userMessage(caught, 'Upload failed. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <DialogContent title="Upload Resume" description="Keep a resume you already have with your documents." size="lg">
      <form onSubmit={(event) => void submit(event)} className="mt-5 flex flex-col gap-5">
        <Field label="File name" hint="Shown in your documents list. Leave it empty to use the file's own name." optional>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. John_Doe_Finance" maxLength={120} disabled={busy} />
        </Field>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx(
            'flex flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-7 text-center transition-colors duration-150',
            dragging ? 'border-primary bg-primary-50' : 'border-control-strong bg-surface-low',
          )}
        >
          {file ? (
            <div className="flex w-full max-w-sm items-center gap-3 rounded-control border border-border bg-surface px-3 py-2.5 text-left shadow-soft">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-container text-primary-ink">
                <FileTextIcon size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">{file.name}</span>
                <span className="text-[13px] text-muted-foreground">{sizeText(file.size)}</span>
              </span>
              <button
                type="button"
                aria-label="Remove the file"
                disabled={busy}
                onClick={() => setFile(null)}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            <>
              <span className="flex size-11 items-center justify-center rounded-full bg-primary-container text-primary-ink">
                <FileArrowUpIcon size={22} />
              </span>
              <p className="text-sm text-foreground">
                Drag a file here, or{' '}
                <button type="button" className="font-semibold text-primary-ink hover:underline" onClick={() => input.current?.click()}>
                  choose a file
                </button>
              </p>
            </>
          )}
          <p className="text-[13px] text-muted-foreground">PDF, DOC, DOCX up to {UPLOAD_MAX_MB} MB</p>
          <input
            ref={input}
            type="file"
            accept={RESUME_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Resume file"
            onChange={(event) => {
              choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Checkbox checked={parse} onCheckedChange={(checked) => setParse(checked)} disabled={busy} label="Make an editable copy with AI" />
          <p className="pl-[28px] text-[13px] leading-5 text-muted-foreground">
            An AI reads the file into a resume you can edit here, on any template. The file itself is kept as uploaded.
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <DialogFooter flush className="pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!file}>
            {busy ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
