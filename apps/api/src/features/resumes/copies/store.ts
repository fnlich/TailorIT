import { randomUUID } from 'node:crypto';
import type { ResumeCopiesResponse, ResumeCopyState } from '@tailorit/shared';
import { AI_MESSAGES } from '../../../ai/index';
import { nowIso, type AppDeps } from '../../../core/context';
import { savepoint } from '../../../core/db/connection';
import { AppError } from '../../../core/http/errors';
import { assertRoomForResumes, requireResume, toSummary } from '../repository';
import { readableForImport, UNREADABLE_TEXT } from '../upload';

// The editable copies asked for with several uploads at once (resume_copy_backlog, migration 0102): one row per
// upload, written in the upload's own transaction, and the view the Resumes tab follows (GET /api/resumes/copies).
// The copy line (./backlog.ts) starts and settles the copies; the buttons of the tab's copy notices (Stop the rest,
// Try again, Dismiss) act here. A row only points at its upload: the upload is never changed, and deleting it takes
// its row with it (a copy already made stays a resume). Every statement is scoped by the account.

/** Why a copy was not made: 'unreadable' and 'gone' (the upload was deleted) cannot be tried again; the others can. */
export type CopyErrorCode = 'unreadable' | 'no_room' | 'ai_off' | 'ai' | 'gone';
const NOT_RETRYABLE: ReadonlySet<string> = new Set(['unreadable', 'gone']);

export const AI_NOT_SET_UP = 'AI is not set up on this server.';

/** Why this server makes no copies (AI off, or no AI service), as the sentence to show; null when it makes them. */
export function copiesOffMessage(deps: Pick<AppDeps, 'config' | 'services'>): string | null {
  if (!deps.config.ai.enabled) return AI_MESSAGES.disabled;
  if (!deps.services.ai) return AI_NOT_SET_UP;
  return null;
}

/** Why a copy asked for now cannot be made, checked in the order a copy asked for alone is; null when it can. */
function refusalOf(
  deps: AppDeps,
  userId: string,
  text: string | null,
): { code: CopyErrorCode; message: string } | null {
  if (!readableForImport(text)) return { code: 'unreadable', message: UNREADABLE_TEXT };
  try {
    // The new upload is counted already: this is the room for its copy.
    assertRoomForResumes(deps, userId, 1);
  } catch (error) {
    if (error instanceof AppError && error.code === 'conflict') return { code: 'no_room', message: error.message };
    throw error;
  }
  const off = copiesOffMessage(deps);
  return off ? { code: 'ai_off', message: off } : null;
}

/**
 * Puts the editable copy of a new upload in line (one of several files of an Upload dialog), inside the upload's own
 * transaction: 'waiting', or 'failed' at once when it cannot be made (text that cannot be read, no room left, AI off).
 * Runs in a savepoint: a row that cannot be written is logged and leaves the upload stored. Returns whether it was
 * written.
 */
export function requestBatchCopy(
  deps: AppDeps,
  userId: string,
  uploadId: string,
  choice: { batchId: string; templateId: string | null },
): boolean {
  try {
    savepoint(deps.db, () => {
      const upload = requireResume(deps, userId, uploadId);
      const refusal = refusalOf(deps, userId, upload.extracted_text);
      const now = nowIso(deps);
      deps.db
        .prepare(
          `INSERT INTO resume_copy_backlog(id, user_id, source_resume_id, batch_id, label, template_id, state,
             next_attempt_at, error_code, error_message, created_at, finished_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          userId,
          uploadId,
          choice.batchId,
          toSummary(deps, upload, null).label,
          choice.templateId,
          refusal ? 'failed' : 'waiting',
          now,
          refusal?.code ?? null,
          refusal?.message ?? null,
          now,
          refusal ? now : null,
          now,
        );
    });
    return true;
  } catch (error) {
    deps.log.error('[resumes] could not put an editable copy in line', error);
    return false;
  }
}

/**
 * The template of the upload's copy in line that a copy asked for alone would take over (it waits, failed or was
 * stopped; see adoptCopyTask), so that copy starts on its batch's template too; null when there is none.
 */
export function adoptableCopyTemplate(deps: Pick<AppDeps, 'db'>, userId: string, uploadId: string): string | null {
  const row = deps.db
    .prepare(
      `SELECT template_id FROM resume_copy_backlog
       WHERE user_id = ? AND source_resume_id = ? AND state IN ('waiting', 'failed', 'stopped')`,
    )
    .get(userId, uploadId) as { template_id: string | null } | undefined;
  return row?.template_id ?? null;
}

/**
 * A copy asked for alone ("Make editable copy", POST /:id/parse) of an upload whose copy in line waits, failed or was
 * stopped: that row follows the task just started, so no second copy is made and a later Try again does not repeat
 * it. A no-op for an upload without such a row.
 */
export function adoptCopyTask(
  deps: Pick<AppDeps, 'db' | 'now'>,
  userId: string,
  uploadId: string,
  taskId: string,
): void {
  const now = nowIso(deps);
  deps.db
    .prepare(
      `UPDATE resume_copy_backlog SET state = 'making', task_id = ?, started_at = ?, retries = 0, error_code = NULL,
         error_message = NULL, finished_at = NULL, updated_at = ?
       WHERE user_id = ? AND source_resume_id = ? AND state IN ('waiting', 'failed', 'stopped')`,
    )
    .run(taskId, now, now, userId, uploadId);
}

interface CopyRow {
  id: string;
  batch_id: string;
  label: string;
  state: ResumeCopyState;
  resume_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

/**
 * GET /api/resumes/copies: the account's copies in the order they were asked for (one per upload, so at most
 * MAX_RESUMES_PER_ACCOUNT), and why those in line wait.
 */
export function listCopies(deps: AppDeps, userId: string): ResumeCopiesResponse {
  const rows = deps.db
    .prepare(
      `SELECT id, batch_id, label, state, resume_id, error_code, error_message FROM resume_copy_backlog
       WHERE user_id = ? ORDER BY created_at, rowid`,
    )
    .all(userId) as CopyRow[];
  const line = deps.services.resumeCopies;
  return {
    items: rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      label: row.label,
      state: row.state,
      resumeId: row.resume_id,
      error: row.state === 'failed' ? row.error_message : null,
      retryable: row.state === 'stopped' || (row.state === 'failed' && !NOT_RETRYABLE.has(row.error_code ?? '')),
    })),
    // No line at all is AI off; the line's own null means the copies do not wait.
    paused: line ? line.waitReason() : { reason: 'off', until: null },
  };
}

/** Stop the rest: the batch's copies still waiting are stopped (one being made finishes). Returns how many. */
export function stopCopies(deps: Pick<AppDeps, 'db' | 'now'>, userId: string, batchId: string): number {
  const now = nowIso(deps);
  return deps.db
    .prepare(
      `UPDATE resume_copy_backlog SET state = 'stopped', finished_at = ?, updated_at = ?
       WHERE user_id = ? AND batch_id = ? AND state = 'waiting'`,
    )
    .run(now, now, userId, batchId).changes;
}

/**
 * Try again: the batch's stopped copies, and those that failed for a reason that can pass (NOT_RETRYABLE aside), wait
 * in line again from the start. Returns how many.
 */
export function retryCopies(deps: Pick<AppDeps, 'db' | 'now'>, userId: string, batchId: string): number {
  const now = nowIso(deps);
  return deps.db
    .prepare(
      `UPDATE resume_copy_backlog SET state = 'waiting', task_id = NULL, retries = 0, error_code = NULL,
         error_message = NULL, finished_at = NULL, next_attempt_at = ?, updated_at = ?
       WHERE user_id = ? AND batch_id = ?
         AND (state = 'stopped' OR (state = 'failed' AND coalesce(error_code, '') NOT IN ('unreadable', 'gone')))`,
    )
    .run(now, now, userId, batchId).changes;
}

/** Dismiss: the batch's finished rows go (ready, failed, stopped); the copies made stay resumes. Returns how many. */
export function dismissCopies(deps: Pick<AppDeps, 'db'>, userId: string, batchId: string): number {
  return deps.db
    .prepare(
      "DELETE FROM resume_copy_backlog WHERE user_id = ? AND batch_id = ? AND state IN ('ready', 'failed', 'stopped')",
    )
    .run(userId, batchId).changes;
}
