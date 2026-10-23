'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react/ArrowSquareOut';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EditorBar } from '@/components/shell/EditorBar';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { DownloadSimpleIcon, SparkleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';
import { useAiTask } from '@/lib/useAiTask';
import { ResumeThumb } from '@/features/documents/resumes/ResumeThumb';
import {
  RESUMES_TAB_HREF,
  readImportResult,
  renameResume,
  resumeEditorHref,
  resumeFileHref,
  resumeKeys,
  startEditableCopy,
  type ResumeView,
} from './api';
import { invalidateResumes, putResumeInList } from './cache';
import { downloadFrom } from './files';

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * An uploaded resume opened at /resumes/[id]: it is a file, not a document this editor writes, so the page shows its
 * first page and offers to open or download it, or to make an editable copy (the AI reads it into a new resume).
 */
export function UploadedResumeView({ resume }: { resume: ResumeView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(resume.label);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = useAiTask(taskId, { kind: 'resume_import' });
  const copyId = taskId && task.isSucceeded ? readImportResult(task.task?.result) : null;

  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!copyId || opened.current === copyId) return;
    opened.current = copyId;
    void queryClient.invalidateQueries({ queryKey: resumeKeys.all });
    router.push(resumeEditorHref(copyId));
  }, [copyId, queryClient, router]);

  const makeCopy = async () => {
    setStarting(true);
    setError(null);
    try {
      setTaskId(await startEditableCopy(resume.id));
    } catch (caught) {
      setError(userMessage(caught, 'The editable copy could not start. Please try again.'));
    } finally {
      setStarting(false);
    }
  };

  const running = starting || (taskId !== null && task.isRunning) || copyId !== null;
  const failure = error ?? (taskId && task.isFailed ? (task.errorMessage ?? 'The resume could not be read.') : null);
  const kind = resume.fileKind ? resume.fileKind.toUpperCase() : null;

  return (
    <>
      <EditorBar
        name={title}
        documentsHref={RESUMES_TAB_HREF}
        onRename={async (name) => {
          const saved = await renameResume(resume.id, name);
          setTitle(name);
          putResumeInList(queryClient, saved.summary);
          void invalidateResumes(queryClient);
        }}
      />
      <main className={clsx('mx-auto w-full max-w-4xl pt-10 pb-16', PAGE_GUTTER)}>
        <div className="grid grid-cols-1 gap-8 rounded-surface border border-border bg-surface p-6 shadow-soft sm:grid-cols-[15rem_minmax(0,1fr)] sm:p-8">
          <div className="overflow-hidden rounded-[10px] border border-border bg-white shadow-soft">
            <ResumeThumb resume={resume} title={`${title} first page`} />
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              {resume.isDefault && <Badge tone="primary">Default</Badge>}
              <Badge>Uploaded</Badge>
              {kind && <Badge>{kind}</Badge>}
            </div>
            <h1 className="mt-3 text-2xl leading-8 font-bold text-foreground [overflow-wrap:anywhere]">{title}</h1>
            {resume.file && (
              <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {resume.file.name} · {sizeText(resume.file.sizeBytes)}
                {resume.file.pageCount ? ` · ${resume.file.pageCount} ${resume.file.pageCount === 1 ? 'page' : 'pages'}` : ''}
              </p>
            )}
            <p className="mt-5 text-sm leading-6 text-foreground">
              This resume is a file you uploaded, so it is kept exactly as it is. To change it here, make an editable copy: an
              AI reads the file into a new resume you can edit, on any template.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => void makeCopy()} disabled={running} icon={running ? <Spinner size={16} /> : <SparkleIcon size={16} weight="fill" />}>
                {running ? 'Making an editable copy...' : 'Make an editable copy'}
              </Button>
              <a href={resumeFileHref(resume.id, true)} target="_blank" rel="noopener" className={buttonClasses({ variant: 'outline' })}>
                <ArrowSquareOutIcon size={16} />
                Open the file
              </a>
              <Button
                variant="ghost"
                icon={<DownloadSimpleIcon size={16} />}
                onClick={() =>
                  void downloadFrom(resumeFileHref(resume.id), resume.file?.name ?? `${title}.${resume.fileKind ?? 'pdf'}`).catch((caught: unknown) =>
                    setError(userMessage(caught, 'The download did not work. Please try again.')),
                  )
                }
              >
                Download
              </Button>
            </div>
            {running && taskId && task.message && <p className="mt-3 text-[13px] text-muted-foreground">{task.message}</p>}
            {failure && (
              <Notice tone="error" className="mt-4">
                {failure}
              </Notice>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
