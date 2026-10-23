import type { AiHealth, Role } from '@tailorit/shared';

/*
 * The admin console's view of the API. The admin endpoints have no contracts in @tailorit/shared yet, so these mirror
 * apps/api/src/features/ingest/sources.ts and router.ts (and F3's admin-users router); keep them in step.
 */

export const SOURCE_KINDS = ['greenhouse', 'lever', 'ashby', 'csv', 'json', 'ft_lake', 'seed'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Kinds an admin adds from the "Add source" dialog (uploads come from Import jobs). */
export const ADDABLE_KINDS = ['greenhouse', 'lever', 'ashby', 'ft_lake', 'seed'] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  csv: 'CSV import',
  json: 'JSON import',
  ft_lake: 'free_tailor lake',
  seed: 'Demo seed',
};

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'partial';
export type RunTrigger = 'schedule' | 'manual' | 'upload' | 'startup';

export interface RunSummary {
  id: number;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  error: string | null;
}

export interface AdminSource {
  id: number;
  kind: SourceKind;
  kindLabel: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  schedule: string;
  deactivateMissing: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  jobCount: number;
  activeJobCount: number;
  running: boolean;
  lastRun: RunSummary | null;
}

export interface AdminRun extends RunSummary {
  sourceId: number;
  sourceKind: SourceKind;
  sourceName: string;
}

export interface AdminRunDetail extends AdminRun {
  log: string[];
}

export interface ListAnswer<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
}

export interface SourceTestResult {
  ok: boolean;
  message: string;
  count: number;
  samples: string[];
  companyName: string | null;
}

export interface LakeTestResult {
  ok: boolean;
  message: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  counts: { jobs: number; withAnalysis: number; recent: number } | null;
  newestUpdatedAt: string | null;
}

export interface NewSourceBody {
  kind: AddableKind;
  name?: string;
  config: Record<string, string>;
}

export const IMPORT_FIELDS = [
  'title',
  'company',
  'url',
  'description',
  'location',
  'postedAt',
  'salary',
  'employmentType',
  'workArrangement',
  'department',
  'id',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Record<ImportField, string | null>;

export interface ImportPreview {
  fileName: string;
  format: 'csv' | 'json';
  columns: string[];
  mapping: ImportMapping;
  fields: Array<{ field: ImportField; label: string; required: boolean }>;
  rowCount: number;
  jobCount: number;
  sample: Array<Record<string, string>>;
  missingRequired: ImportField[];
  problems: string[];
}

export interface ImportResult {
  source: AdminSource;
  /** Null when a large file is still importing in the background (follow `runId` under Runs). */
  run: AdminRunDetail | null;
  runId: number;
}

export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type ReportFilter = ReportStatus | 'all';

export interface AdminReport {
  id: number;
  status: ReportStatus;
  reason: 'inactive' | 'spam' | 'inaccurate' | 'duplicate' | 'other';
  reasonLabel: string;
  details: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reporter: { id: string; email: string; name: string };
  job: { id: number; title: string; companyName: string; active: boolean; applyUrl: string };
}

export interface ReportsAnswer {
  items: AdminReport[];
  total: number;
  counts: Record<ReportStatus, number>;
}

export type { AiHealth };

export interface AiTestResult {
  ok: boolean;
  model: string;
  ms: number;
  answer: string | null;
  error?: { code: string; message: string; detail: string };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

export type AdminUserPatchAnswer = AdminUser & { note?: string };
