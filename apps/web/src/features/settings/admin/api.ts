import { SheetAccountSchema, SheetPreviewSchema } from '@tailorit/shared/ingest';
import { api } from '@/lib/api';
import type {
  AdminReport,
  AdminRun,
  AdminRunDetail,
  AdminSource,
  AdminUser,
  AdminUserPatchAnswer,
  AiHealth,
  AiTestResult,
  ImportMapping,
  ImportPreview,
  ImportResult,
  LakeTestResult,
  ListAnswer,
  NewSourceBody,
  ReportFilter,
  ReportsAnswer,
  ReportStatus,
  SheetAccount,
  SheetImportBody,
  SheetPreview,
  SheetPreviewBody,
  SourceTestResult,
} from './types';

/** React Query keys of the admin console. */
export const adminKeys = {
  all: ['admin'] as const,
  sources: ['admin', 'sources'] as const,
  runs: (sourceId: number | null) => ['admin', 'runs', sourceId ?? 'all'] as const,
  run: (id: number) => ['admin', 'run', id] as const,
  reports: (status: ReportFilter) => ['admin', 'reports', status] as const,
  aiHealth: ['admin', 'ai', 'health'] as const,
  users: ['admin', 'users'] as const,
  sheetAccount: ['admin', 'import', 'sheets', 'account'] as const,
};

// --------------------------------------------------------------------------------------------- sources & runs

export function fetchSources(signal?: AbortSignal) {
  return api.get<ListAnswer<AdminSource>>('/api/admin/sources', { signal });
}

export function createSource(body: NewSourceBody) {
  return api.post<AdminSource>('/api/admin/sources', body);
}

export function updateSource(id: number, patch: { enabled?: boolean; name?: string }) {
  return api.patch<AdminSource>(`/api/admin/sources/${id}`, patch);
}

export function deleteSource(id: number) {
  return api.delete<void>(`/api/admin/sources/${id}`);
}

export function runSource(id: number) {
  return api.post<{ runId: number; sourceId: number }>(`/api/admin/sources/${id}/run`);
}

export function testSource(body: { kind: 'greenhouse' | 'lever' | 'ashby' | 'ft_lake'; config: Record<string, string> }) {
  return api.post<SourceTestResult>('/api/admin/sources/test', body);
}

export function testLake(path: string) {
  return api.post<LakeTestResult>('/api/admin/sources/ft-lake/test', path.trim() ? { path: path.trim() } : {});
}

export function fetchRuns(options: { sourceId: number | null; cursor?: string; signal?: AbortSignal }) {
  return api.get<ListAnswer<AdminRun>>('/api/admin/runs', {
    signal: options.signal,
    query: { sourceId: options.sourceId ?? undefined, cursor: options.cursor, limit: 25 },
  });
}

export function fetchRun(id: number, signal?: AbortSignal) {
  return api.get<AdminRunDetail>(`/api/admin/runs/${id}`, { signal });
}

// ------------------------------------------------------------------------------------------------ import jobs

function importForm(file: File, mapping?: ImportMapping, name?: string): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  if (mapping) form.append('mapping', JSON.stringify(mapping));
  if (name?.trim()) form.append('name', name.trim());
  return form;
}

export function previewImport(file: File, mapping?: ImportMapping) {
  return api.post<ImportPreview>('/api/admin/import/jobs/preview', importForm(file, mapping));
}

export function importJobs(file: File, mapping: ImportMapping, name?: string) {
  return api.post<ImportResult>('/api/admin/import/jobs', importForm(file, mapping, name));
}

// ------------------------------------------------------------------------------------- Google Sheet import

/** Whether the server has a service account key, and the address to share sheets with. */
export function fetchSheetAccount(signal?: AbortSignal) {
  return api.get<SheetAccount>('/api/admin/import/sheets/account', { signal, schema: SheetAccountSchema });
}

/** Reads a tab (or, with `refresh: false`, re-maps the last read) and answers its preview. Saves nothing. */
export function previewSheet(body: SheetPreviewBody, signal?: AbortSignal) {
  return api.post<SheetPreview>('/api/admin/import/sheets/preview', body, { signal, schema: SheetPreviewSchema });
}

/** Reads the tab again and imports it: 201 with the run, or 202 while it imports in the background. */
export function importSheet(body: SheetImportBody) {
  return api.post<ImportResult>('/api/admin/import/sheets/jobs', body);
}

// ---------------------------------------------------------------------------------------------------- reports

export function fetchReports(status: ReportFilter, signal?: AbortSignal) {
  return api.get<ReportsAnswer>('/api/admin/reports', { signal, query: { status } });
}

export function updateReport(id: number, body: { status: ReportStatus; closeJob?: boolean }) {
  return api.patch<AdminReport>(`/api/admin/reports/${id}`, body);
}

// --------------------------------------------------------------------------------------------- AI and users

export function fetchAiHealth(force = false, signal?: AbortSignal) {
  return api.get<AiHealth>('/api/admin/ai/health', { signal, query: { force: force ? 1 : undefined } });
}

export function runAiTest() {
  return api.post<AiTestResult>('/api/admin/ai/test', {});
}

export function fetchUsers(signal?: AbortSignal) {
  return api.get<ListAnswer<AdminUser>>('/api/admin/users', { signal });
}

export function updateUser(id: string, patch: { role?: AdminUser['role']; disabled?: boolean }) {
  return api.patch<AdminUserPatchAnswer>(`/api/admin/users/${id}`, patch);
}
