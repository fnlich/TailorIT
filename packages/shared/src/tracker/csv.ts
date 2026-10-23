import { toIsoDate, parseFlexibleDate } from '../format/dates';
import { htmlToText } from '../format/text';
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '../jobs/enums';
import { STATUS, statusLabel, type ApplicationStatus } from './statuses';

// The tracker's CSV import and export. The web parses the file (papaparse) and maps columns; the API receives mapped
// rows and writes the export with these columns.

/**
 * A job type from a title when the file has none (Simplify's rule): intern / co-op -> Internship; part-time, contract,
 * temp or freelance -> Part-Time; anything else Full-Time.
 */
export function guessJobType(title: string | null | undefined): EmploymentType {
  const text = title ?? '';
  if (/\bintern(?:ship)?s?\b|\bco-?op\b/i.test(text)) return 'internship';
  if (/\bpart[\s-]?time\b|\bcontract(?:or)?\b|\btemp(?:orary)?\b|\bfreelance(?:r)?\b/i.test(text)) return 'part_time';
  return 'full_time';
}

/** A job type as a file writes it ("Full-Time", "full time", "Internship", "Contract"); null when unknown. */
export function mapJobTypeText(text: string | null | undefined): EmploymentType | null {
  const value = (text ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!value) return null;
  if (/^(?:full ?time|ft|permanent|regular)$/.test(value)) return 'full_time';
  if (/^(?:part ?time|pt)$/.test(value)) return 'part_time';
  if (/^(?:intern|internship|co ?op|coop)$/.test(value)) return 'internship';
  if (/^(?:contract|contractor|temp|temporary|freelance|freelancer)$/.test(value)) return 'contract';
  return null;
}

const STATUS_WORDS: ReadonlyArray<readonly [RegExp, ApplicationStatus]> = [
  [/^(?:saved|save|bookmarked|wishlist|wish list|interested|to apply|not applied|planned|watching)$/, STATUS.saved],
  [/^(?:applied|apply|submitted|application submitted|sent|in review|under review|pending)$/, STATUS.applied],
  [/^(?:screen|screening|phone screen|recruiter screen|recruiter call|hr screen|assessment|online assessment|oa|coding challenge)$/, STATUS.screen],
  [/^(?:interview|interviews|interviewing|onsite|on site|final round|technical interview|phone interview)$/, STATUS.interviewing],
  [/^(?:offer|offered|offer received|offer extended)$/, STATUS.offer],
  [/^(?:withdrawn|withdrew|withdraw|declined offer|i declined|not interested)$/, STATUS.withdrawn],
  [/^(?:ghosted|no response|no reply|no answer|unresponsive)$/, STATUS.ghosted],
  [/^(?:rejected|rejection|declined|not selected|no offer|denied|closed|turned down|unsuccessful)$/, STATUS.rejected],
  [/^(?:accepted|accepted offer|hired|joined|signed)$/, STATUS.accepted],
];

/**
 * A status from a file's text ("Phone screen" -> Screen, "Rejected" -> Rejected), or from a code or key
 * ("12", "interviewing"); null for text the import wizard must ask about ("Map status values").
 */
export function mapStatusText(text: string | null | undefined): ApplicationStatus | null {
  const value = (text ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!value) return null;
  const code = Number(value);
  if ([1, 2, 11, 12, 13, 21, 22, 23, 24].includes(code)) return code as ApplicationStatus;
  for (const [pattern, status] of STATUS_WORDS) if (pattern.test(value)) return status;
  return null;
}

// ------------------------------------------------------------------------------------------------------ export

/** TailorIT's export columns (Simplify's are unknown). */
export const EXPORT_CSV_COLUMNS = [
  'Company',
  'Position Title',
  'Location',
  'Job Type',
  'Status',
  'Applied Date',
  'Added Date',
  'Job Posting Link',
  'Salary Min',
  'Salary Max',
  'Currency',
  'Pay Period',
  'Favorite',
  'Archived',
  'Notes',
] as const;

/**
 * The tracker's pay periods (the detail form's select), the ones `applications.salary_period` accepts. Simplify also
 * offers Bi-Weekly; storing it needs 'biweek' in that column's CHECK first.
 */
export const TRACKER_PAY_PERIODS = ['hour', 'day', 'week', 'month', 'year'] as const;
export type TrackerPayPeriod = (typeof TRACKER_PAY_PERIODS)[number];
export const TRACKER_PAY_PERIOD_LABEL: Record<TrackerPayPeriod, string> = {
  hour: 'Hourly',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
};

/** What one export row reads. */
export interface ExportApplication {
  companyName: string;
  title: string;
  location: string;
  employmentType: EmploymentType;
  currentStatus: ApplicationStatus;
  appliedOn: string | null;
  trackedOn: string;
  postingUrl: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  favorite: boolean;
  archivedAt: string | null;
  notesHtml: string;
}

/** One application as export cells, in `EXPORT_CSV_COLUMNS` order. Dates are "YYYY-MM-DD"; notes plain text. */
export function exportCsvRow(application: ExportApplication): string[] {
  const period = application.salaryPeriod as TrackerPayPeriod | null;
  return [
    application.companyName,
    application.title,
    application.location,
    EMPLOYMENT_TYPE_LABEL[application.employmentType] ?? application.employmentType,
    statusLabel(application.currentStatus),
    application.appliedOn ?? '',
    toIsoDate(application.trackedOn) ?? application.trackedOn,
    application.postingUrl,
    application.salaryMin === null ? '' : String(application.salaryMin),
    application.salaryMax === null ? '' : String(application.salaryMax),
    application.salaryCurrency ?? '',
    period ? (Object.hasOwn(TRACKER_PAY_PERIOD_LABEL, period) ? TRACKER_PAY_PERIOD_LABEL[period] : period) : '',
    application.favorite ? 'Yes' : 'No',
    application.archivedAt ? 'Yes' : 'No',
    htmlToText(application.notesHtml),
  ];
}

/**
 * One CSV cell: quoted when it holds a comma, quote, line break or edge space, with quotes doubled. A cell that a
 * spreadsheet would run as a formula (=, +, @, a tab, or "-" before a letter) gets a leading apostrophe.
 */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+@\t\r]/.test(text) || /^-[^\s\d]/.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows as RFC 4180 CSV with CRLF line ends (Excel-friendly). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** The whole export: header row then one row per application. */
export function buildExportCsv(applications: readonly ExportApplication[]): string {
  return toCsv([[...EXPORT_CSV_COLUMNS], ...applications.map(exportCsvRow)]);
}

/** "tailorit-applications-2026-10-22.csv". */
export function exportCsvFileName(date: Date | string | number): string {
  return `tailorit-applications-${toIsoDate(date) ?? 'export'}.csv`;
}

// ------------------------------------------------------------------------------------------------------ import

export const TRACKER_IMPORT_FIELDS = [
  { key: 'title', label: 'Position Title', required: true },
  { key: 'companyName', label: 'Company', required: true },
  { key: 'location', label: 'Location', required: false },
  { key: 'employmentType', label: 'Job Type', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'postingUrl', label: 'Job Posting Link', required: false },
  { key: 'appliedOn', label: 'Application Date', required: false },
] as const;
export type TrackerImportField = (typeof TRACKER_IMPORT_FIELDS)[number]['key'];

const HEADER_WORDS: Record<TrackerImportField, readonly string[]> = {
  title: ['position title', 'position', 'title', 'job title', 'role', 'job', 'job name'],
  companyName: ['company', 'company name', 'employer', 'organization', 'organisation'],
  location: ['location', 'city', 'place', 'job location'],
  employmentType: ['job type', 'type', 'employment type', 'employment'],
  status: ['status', 'stage', 'application status', 'state'],
  notes: ['notes', 'note', 'comments', 'comment'],
  postingUrl: ['job posting link', 'link', 'url', 'job link', 'job url', 'posting url', 'posting link', 'job posting url'],
  appliedOn: ['application date', 'applied date', 'date applied', 'applied on', 'applied', 'date'],
};

function foldHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_*:-]+/g, ' ').trim();
}

/** The wizard's first guess at "Map your columns": field -> column index, each column used once. */
export function guessImportMapping(headers: readonly string[]): Partial<Record<TrackerImportField, number>> {
  const folded = headers.map(foldHeader);
  const used = new Set<number>();
  const mapping: Partial<Record<TrackerImportField, number>> = {};
  for (const { key } of TRACKER_IMPORT_FIELDS) {
    for (const word of HEADER_WORDS[key]) {
      const index = folded.findIndex((header, at) => header === word && !used.has(at));
      if (index >= 0) {
        mapping[key] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

/** One mapped row as the import endpoint receives it: raw text per field. */
export interface TrackerImportRowInput {
  title?: string;
  companyName?: string;
  location?: string;
  employmentType?: string;
  status?: string;
  notes?: string;
  postingUrl?: string;
  appliedOn?: string;
}

/** A row ready to create, or the reason it is skipped. */
export type TrackerImportRowResult =
  | {
      ok: true;
      title: string;
      companyName: string;
      location: string;
      employmentType: EmploymentType;
      status: ApplicationStatus;
      notes: string;
      postingUrl: string;
      appliedOn: string | null;
    }
  | { ok: false; message: string };

/**
 * Reads one mapped row: the status from the wizard's `statusMap` (keyed by the file's text, case-insensitively), else
 * `mapStatusText`, else Applied; the job type from its column, else guessed from the title; the date in any common
 * format. A row without a title or a company is skipped.
 */
export function readImportRow(
  row: TrackerImportRowInput,
  statusMap: Readonly<Record<string, ApplicationStatus>> = {},
): TrackerImportRowResult {
  const title = (row.title ?? '').trim();
  const companyName = (row.companyName ?? '').trim();
  if (!title) return { ok: false, message: 'Position Title is required.' };
  if (!companyName) return { ok: false, message: 'Company is required.' };
  const statusText = (row.status ?? '').trim();
  const mapped = Object.entries(statusMap).find(([text]) => text.trim().toLowerCase() === statusText.toLowerCase());
  return {
    ok: true,
    title: title.slice(0, 200),
    companyName: companyName.slice(0, 200),
    location: (row.location ?? '').trim().slice(0, 200),
    employmentType: mapJobTypeText(row.employmentType) ?? guessJobType(title),
    status: mapped?.[1] ?? mapStatusText(statusText) ?? STATUS.applied,
    notes: (row.notes ?? '').trim(),
    postingUrl: (row.postingUrl ?? '').trim(),
    appliedOn: parseFlexibleDate(row.appliedOn ?? ''),
  };
}

/** The distinct status texts of a file that `mapStatusText` cannot place: the wizard's "Map status values" list. */
export function unmappedStatusTexts(rows: readonly TrackerImportRowInput[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const text = (row.status ?? '').trim();
    if (text && mapStatusText(text) === null && !out.some((held) => held.toLowerCase() === text.toLowerCase())) {
      out.push(text);
    }
  }
  return out;
}
