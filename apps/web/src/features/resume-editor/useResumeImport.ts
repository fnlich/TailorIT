'use client';

import { readResumeImport, type TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { userMessage } from '@/lib/api';
import { useAiTask } from '@/lib/useAiTask';
import { importResumeJson, readImportResult, resumeKeys, uploadResume } from './api';
import { pdfRefusal, readJsonFile } from './files';

export type ImportPhase = 'idle' | 'uploading' | 'reading' | 'opening' | 'importing';

/**
 * The two ways an existing resume comes in, for the template chooser and "Import your existing resume":
 *  - a resume PDF: uploaded with `?parse=1`, which keeps the file and starts the AI import; the task's result names the
 *    new, editable resume (`onImported` opens it);
 *  - a resume JSON file (downloaded from TailorIT or free_tailor): checked here, imported at once; one resume opens,
 *    several are reported in `notice`.
 */
export function useResumeImport(onImported: (resumeId: string) => void | Promise<void>) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'pdf' | 'json' | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ imported: number; fileName: string } | null>(null);
  const task = useAiTask(taskId, { kind: 'resume_import' });

  const resultId = taskId && task.isSucceeded ? readImportResult(task.task?.result) : null;
  const taskError =
    taskId && task.isFailed
      ? (task.errorMessage ?? 'The resume could not be read. Please try again.')
      : taskId && task.isSucceeded && !resultId
        ? 'The resume could not be read. Please try again.'
        : null;

  // The new resume opens once, when the task says which it is.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || !resultId || handled.current === taskId) return;
    handled.current = taskId;
    void queryClient.invalidateQueries({ queryKey: resumeKeys.all });
    void onImported(resultId);
  }, [taskId, resultId, onImported, queryClient]);

  const reading = taskId !== null && task.isRunning;
  const phase: ImportPhase =
    busy === 'pdf' ? 'uploading' : busy === 'json' ? 'importing' : reading ? 'reading' : resultId ? 'opening' : 'idle';

  const importPdf = useCallback(
    async (file: File, choice: { templateId?: string; layout?: TechnicalSkillsLayout } = {}) => {
      if (busy || reading) return;
      setNotice(null);
      const refusal = pdfRefusal(file);
      if (refusal) {
        setError(refusal);
        return;
      }
      setError(null);
      setTaskId(null);
      setBusy('pdf');
      try {
        const answer = await uploadResume(file, { parse: true, ...choice });
        void queryClient.invalidateQueries({ queryKey: resumeKeys.all });
        if (!answer.taskId) {
          setError('The file was uploaded, but reading it did not start. Use "Make editable copy" on it in your documents.');
          return;
        }
        setTaskId(answer.taskId);
      } catch (caught) {
        setError(userMessage(caught, 'Could not upload that file. Please try again.'));
      } finally {
        setBusy(null);
      }
    },
    [busy, reading, queryClient],
  );

  const importJson = useCallback(
    async (file: File) => {
      if (busy || reading) return;
      setNotice(null);
      setError(null);
      setBusy('json');
      try {
        const data = await readJsonFile(file);
        const checked = readResumeImport(data);
        if (!checked.ok) {
          setError(checked.message);
          return;
        }
        const { ids, imported } = await importResumeJson(data, file.name);
        await queryClient.invalidateQueries({ queryKey: resumeKeys.all });
        if (ids.length === 1 && ids[0]) {
          await onImported(ids[0]);
          return;
        }
        setNotice({ imported, fileName: file.name });
      } catch (caught) {
        setError(caught instanceof Error && !('status' in caught) ? caught.message : userMessage(caught, 'Could not import that file.'));
      } finally {
        setBusy(null);
      }
    },
    [busy, reading, onImported, queryClient],
  );

  return {
    phase,
    working: phase !== 'idle',
    error: error ?? taskError,
    /** The rotating progress line while the AI reads the PDF. */
    progress: task.message,
    notice,
    importPdf,
    importJson,
    clearError: () => {
      setError(null);
      if (taskError) setTaskId(null);
    },
  };
}
