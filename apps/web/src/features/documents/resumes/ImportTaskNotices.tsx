'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { useAiTask } from '@/lib/useAiTask';
import { readImportResult, resumeEditorHref, resumeKeys } from '../../resume-editor/api';

export interface ImportTask {
  /** Unique per notice (the task id when there is one). */
  key: string;
  /** The AI import being made; null when it could not start (`error` says why). */
  taskId: string | null;
  /** The uploaded resume the copy is made from. */
  label: string;
  /** Why the editable copy could not start (the upload is kept either way). */
  error?: string | null;
}

/**
 * The editable copies being made (Upload with "Make an editable copy with AI", or "Make editable copy" on an upload):
 * each is polled until it finishes, then offers to open the new resume (or says why it could not be made, or that it
 * was cancelled). A copy that could not even start says so at once.
 */
export function ImportTaskNotices({ tasks, onDismiss }: { tasks: readonly ImportTask[]; onDismiss: (key: string) => void }) {
  if (tasks.length === 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-3">
      {tasks.map((task) =>
        task.taskId ? (
          <ImportTaskNotice key={task.key} taskId={task.taskId} label={task.label} onDismiss={() => onDismiss(task.key)} />
        ) : (
          <Notice
            key={task.key}
            tone="warning"
            title={`The editable copy of ${task.label} could not start`}
            action={<DismissButton onClick={() => onDismiss(task.key)} />}
          >
            {task.error || 'Try again with "Make editable copy" on the uploaded resume.'} Your upload is kept as it is.
          </Notice>
        ),
      )}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      Dismiss
    </Button>
  );
}

function ImportTaskNotice({ taskId, label, onDismiss }: { taskId: string; label: string; onDismiss: () => void }) {
  const queryClient = useQueryClient();
  const ai = useAiTask(taskId, { kind: 'resume_import' });
  const resumeId = ai.isSucceeded ? readImportResult(ai.task?.result) : null;

  // The new resume joins the list once it exists.
  const refreshed = useRef(false);
  useEffect(() => {
    if (!resumeId || refreshed.current) return;
    refreshed.current = true;
    void queryClient.invalidateQueries({ queryKey: resumeKeys.all });
  }, [resumeId, queryClient]);

  const dismiss = <DismissButton onClick={onDismiss} />;

  if (resumeId) {
    return (
      <Notice
        tone="success"
        title="Your editable copy is ready"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={resumeEditorHref(resumeId)} className={buttonClasses({ size: 'sm' })}>
              Open the resume
            </Link>
            {dismiss}
          </div>
        }
      >
        The AI read {label} into a resume you can edit.
      </Notice>
    );
  }
  // Cancelled is finished too: it never turns into a copy.
  if (ai.status === 'cancelled') {
    return (
      <Notice tone="warning" title={`The editable copy of ${label} was cancelled`} action={dismiss}>
        Make it again with &quot;Make editable copy&quot; on the uploaded resume.
      </Notice>
    );
  }
  if (ai.isFailed || (ai.isSucceeded && !resumeId)) {
    return (
      <Notice tone="error" title={`The editable copy of ${label} could not be made`} action={dismiss}>
        {ai.errorMessage ?? 'Please try again with "Make editable copy" on the uploaded resume.'}
      </Notice>
    );
  }
  return (
    <div role="status" className="flex items-center gap-3 rounded-control bg-sky px-3.5 py-3 text-sm text-sky-foreground">
      <Spinner size={16} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Making an editable copy of {label}.</span>{' '}
        {ai.message ?? 'Reading your resume...'} This can take a minute.
      </span>
    </div>
  );
}
