import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportMapping, SheetSourceConfig } from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { conflict } from '../../core/http/errors';
import { importsRoot, sheetOfConfig } from './adapters/tabular';
import { requireIngest } from './service';
import { adminSource, findSheetSource, findSourceRecord, insertSource, type AdminRunDetail, type AdminSource } from './sources';

// Storing an import (a CSV/JSON file, or the CSV copy of a Google Sheet tab) as a csv/json source and running it. One
// stored file per source: importing again under the same name (or the same sheet tab) replaces the copy; unchanged
// rows stay unchanged and rows that are gone stay open (csv/json sources never close missing postings).

/** Imports with more rows than this run in the background instead of holding the request (Next's proxy waits 120 s). */
export const BACKGROUND_IMPORT_ROWS = 2000;

export function safeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'import';
}

export interface ImportRequest {
  kind: 'csv' | 'json';
  sourceName: string;
  /** The name shown for the stored file. */
  fileName: string;
  text: string;
  mapping: ImportMapping;
  /** Rows below the header: more than BACKGROUND_IMPORT_ROWS import in the background. */
  rowCount: number;
  /** Where a Google Sheet copy came from (config.sheet). */
  sheet?: SheetSourceConfig;
  /** How long the caller may still wait for the run, in ms: a run that takes longer answers 202. Default: no limit. */
  waitMs?: number;
}

export interface ImportResult {
  source: AdminSource;
  /** Null while the import runs in the background (follow `runId` under Runs). */
  run: AdminRunDetail | null;
  runId: number;
}

/** The run, or null when it is still going after `ms`. */
async function finishedWithin(done: Promise<AdminRunDetail>, ms: number): Promise<AdminRunDetail | null> {
  if (ms <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([done, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds or creates the source, stores the text as its one file, sets its config and starts its run. 201 with the run
 * once it finished; 202 (run null) for a large import, or when the run outlasts `waitMs`. 409 when the source is
 * running or the name belongs to another import (a file import and a sheet import never share a source).
 */
export async function storeAndRunImport(deps: AppDeps, request: ImportRequest): Promise<{ status: 201 | 202; body: ImportResult }> {
  const { db } = deps;
  const { kind, sourceName, sheet } = request;
  const now = nowIso(deps);
  const service = requireIngest(deps);
  // From here to service.run nothing awaits, so two imports cannot interleave.
  const named = findSourceRecord(db, kind, sourceName);
  const sameTab = sheet ? findSheetSource(db, sheet.spreadsheetId, sheet.gid) : null;
  if (sheet) {
    if (named && named.id !== sameTab?.id) {
      const other = sheetOfConfig(named.config);
      throw conflict(
        other
          ? `"${sourceName}" imports another tab ("${other.tabTitle}" of "${other.spreadsheetTitle}"). Choose another source name.`
          : `A file import is already named "${sourceName}". Choose another source name.`,
      );
    }
  } else if (named && sheetOfConfig(named.config)) {
    throw conflict(`A Google Sheet import is already named "${sourceName}". Choose another source name.`);
  }
  let source = sameTab ?? named;
  if (source && service.isRunning(source.id)) throw conflict('This import is running. Wait for it to finish.');
  if (source && source.name !== sourceName) {
    // The same tab imported again under a new name: one source per tab, renamed.
    db.prepare('UPDATE job_sources SET name = ?, updated_at = ? WHERE id = ?').run(sourceName, now, source.id);
  }
  source ??= insertSource(db, { kind, name: sourceName, config: {} }, now);
  const folder = join(importsRoot(deps), String(source.id));
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const relative = `${source.id}/${now.replace(/[:.]/g, '-')}-${safeFileName(request.fileName)}`;
  writeFileSync(join(importsRoot(deps), relative), request.text, 'utf8');
  const config = { file: relative, fileName: request.fileName, format: kind, mapping: request.mapping, ...(sheet ? { sheet } : {}) };
  db.prepare('UPDATE job_sources SET config = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), now, source.id);
  const started = service.run(source.id, 'upload', { bypassSlots: true });
  const id = source.id;
  const background = () => ({ status: 202 as const, body: { source: adminSource(db, id, true)!, run: null, runId: started.runId } });
  if (request.rowCount > BACKGROUND_IMPORT_ROWS) return background();
  const run = request.waitMs === undefined ? await started.done : await finishedWithin(started.done, request.waitMs);
  if (!run) return background();
  return { status: 201, body: { source: adminSource(db, id, false)!, run, runId: started.runId } };
}
