'use client';

import {
  AI_PROGRESS_MESSAGES,
  AiTaskViewSchema,
  type AiTaskKind,
  type AiTaskStatus,
  type AiTaskView,
} from '@tailorit/shared/ai';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type ApiError } from './api';

/** How often a running task is polled. */
export const AI_TASK_POLL_MS = 1500;
/** How long each staged progress line stays before the next one (the last one stays). */
export const AI_PROGRESS_STEP_MS = 3500;

const TERMINAL: ReadonlySet<AiTaskStatus> = new Set(['succeeded', 'failed', 'cancelled']);

export function isTerminalTaskStatus(status: AiTaskStatus | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

export function aiTaskQueryKey(taskId: string) {
  return ['ai-task', taskId] as const;
}

export interface UseAiTaskOptions {
  /** Known before the first poll answers, so the first progress line shows at once. */
  kind?: AiTaskKind;
}

export interface UseAiTaskResult {
  task: AiTaskView | undefined;
  status: AiTaskStatus | undefined;
  /** Queued or running (or waiting for the first answer). */
  isRunning: boolean;
  isSucceeded: boolean;
  isFailed: boolean;
  /** The task's own error, or the polling error. */
  errorMessage: string | null;
  /** The staged progress line for the task's kind (AI_PROGRESS_MESSAGES), or null when idle. */
  message: string | null;
  /** DELETE /api/ai/tasks/:id. */
  cancel: () => Promise<void>;
}

/**
 * Polls GET /api/ai/tasks/:id every 1.5 s until the task finishes (succeeded, failed or cancelled). Every AI endpoint
 * answers `202 { taskId }`, because CLI calls outlast Next's proxy timeout. Pass `null` to stay idle.
 */
export function useAiTask(taskId: string | null | undefined, options: UseAiTaskOptions = {}): UseAiTaskResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: aiTaskQueryKey(taskId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<AiTaskView>(`/api/ai/tasks/${encodeURIComponent(taskId ?? '')}`, {
        schema: AiTaskViewSchema,
        signal,
      }),
    enabled: Boolean(taskId),
    staleTime: 0,
    refetchInterval: (current) => (isTerminalTaskStatus(current.state.data?.status) ? false : AI_TASK_POLL_MS),
    refetchIntervalInBackground: true,
  });

  const task = taskId ? query.data : undefined;
  const status = task?.status;
  const isRunning = Boolean(taskId) && !isTerminalTaskStatus(status) && !query.isError;
  const kind = task?.kind ?? options.kind;

  // The staged line advances on a timer while the task runs and restarts for each new task.
  const [stage, setStage] = useState({ taskId: taskId ?? null, step: 0 });
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setStage((current) =>
        current.taskId === (taskId ?? null) ? { ...current, step: current.step + 1 } : { taskId: taskId ?? null, step: 1 },
      );
    }, AI_PROGRESS_STEP_MS);
    return () => window.clearInterval(timer);
  }, [isRunning, taskId]);

  const step = stage.taskId === (taskId ?? null) ? stage.step : 0;
  const lines = kind ? AI_PROGRESS_MESSAGES[kind] : [];
  const message = isRunning && lines.length > 0 ? (lines[Math.min(step, lines.length - 1)] ?? null) : null;

  const pollError = query.error as ApiError | null;
  const errorMessage =
    status === 'failed' ? (task?.error?.message ?? 'That did not work. Please try again.') : (pollError?.message ?? null);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    await apiFetch(`/api/ai/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: aiTaskQueryKey(taskId) });
  }, [queryClient, taskId]);

  return {
    task,
    status,
    isRunning,
    isSucceeded: status === 'succeeded',
    isFailed: status === 'failed' || (Boolean(taskId) && query.isError),
    errorMessage,
    message,
    cancel,
  };
}
