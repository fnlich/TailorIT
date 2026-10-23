'use client';

import { FileCsvIcon } from '@phosphor-icons/react/FileCsv';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  EMPLOYMENT_TYPE_LABEL,
  STATUS,
  TRACKER_IMPORT_FIELDS,
  guessImportMapping,
  mapJobTypeText,
  unmappedStatusTexts,
  type ApplicationStatus,
  type EmploymentType,
  type TrackerImportField,
  type TrackerImportRowInput,
} from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { FieldLabel } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { CheckCircleIcon, UploadSimpleIcon, WarningCircleIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import { CompanyInput } from '../CompanyInput';
import { invalidateApplications, trackerApi } from '../data';
import { statusOptions } from '../status';

type Step = 'file' | 'header' | 'map' | 'companies' | 'statuses' | 'jobTypes' | 'importing' | 'done';

/** The checks between "Map your columns" and the import, in Simplify's order; each one only when the file needs it. */
const REVIEW_STEPS = ['companies', 'statuses', 'jobTypes'] as const;
type ReviewStep = (typeof REVIEW_STEPS)[number];

/** "Map job types": a type, or the guess from the title (what the import does with a type it cannot read). */
type JobTypeChoice = EmploymentType | 'guess';
const JOB_TYPE_CHOICES: Array<{ value: JobTypeChoice; label: string }> = [
  { value: 'guess', label: 'Guess from the title' },
  { value: 'internship', label: EMPLOYMENT_TYPE_LABEL.internship },
  { value: 'full_time', label: EMPLOYMENT_TYPE_LABEL.full_time },
  { value: 'part_time', label: EMPLOYMENT_TYPE_LABEL.part_time },
  { value: 'contract', label: EMPLOYMENT_TYPE_LABEL.contract },
];

/** "Review companies" lists this many new companies; the rest keep the file's names. */
const MAX_COMPANY_REVIEW = 100;
/** Company names per "which do you know?" request (the endpoint's cap). */
const NAMES_PER_CHECK = 1000;

/** Rows the import did not add, as indexes into the rows sent (a single row, or a skipped batch). */
interface NotImported {
  from: number;
  to: number;
  message: string;
}

/** A batch whose request failed: the import waits for Retry, Skip these rows or Stop import. */
interface FailedBatch {
  start: number;
  end: number;
  message: string;
}

/** The distinct non-empty texts of a column, compared without case (the first spelling is kept). */
function distinctTexts(values: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = (value ?? '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

type Mapping =
  | { kind: 'none' }
  | { kind: 'column'; index: number }
  | { kind: 'custom'; value: string };

const MAX_ROWS = 5000;
/** Rows per request: small enough that long notes stay well under the API body limit. */
const CHUNK = 100;

/** What the import keeps of each cell (the server cuts titles, companies and locations to 200 characters too). */
const CELL_LIMIT: Record<TrackerImportField, number> = {
  title: 200,
  companyName: 200,
  location: 200,
  employmentType: 100,
  status: 100,
  notes: 20_000,
  postingUrl: 2_000,
  appliedOn: 100,
};
const BOM = String.fromCharCode(0xfeff);
const HEADER_CHOICES = 10;

/** "Column C" for a header cell that is empty. */
const columnName = (headers: readonly string[], index: number) =>
  headers[index]?.trim() || `Column ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;

function readFile(file: File): Promise<string[][]> {
  return import('papaparse').then(
    ({ default: Papa }) =>
      new Promise<string[][]>((resolve, reject) => {
        Papa.parse<string[]>(file, {
          skipEmptyLines: 'greedy',
          complete: (result) => {
            const rows = result.data.filter((row) => Array.isArray(row));
            if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(BOM, '');
            resolve(rows);
          },
          error: (error) => reject(error),
        });
      }),
  );
}

function mappedRows(rows: readonly string[][], mapping: Record<TrackerImportField, Mapping>): TrackerImportRowInput[] {
  return rows.map((row) => {
    const out: TrackerImportRowInput = {};
    for (const { key } of TRACKER_IMPORT_FIELDS) {
      const map = mapping[key];
      if (map.kind === 'column') out[key] = (row[map.index] ?? '').trim().slice(0, CELL_LIMIT[key]);
      else if (map.kind === 'custom') out[key] = map.value.slice(0, CELL_LIMIT[key]);
    }
    return out;
  });
}

/**
 * Simplify's "Import Applications from CSV": choose the file, pick the header row, map the columns (two required,
 * six optional, any of them a custom value), review the companies TailorIT does not know, map the status words and
 * job types the import cannot read, then import in batches. A batch that fails waits for Retry or Skip; the summary
 * names every row that was not imported.
 */
export function ImportCsvDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<TrackerImportField, Mapping> | null>(null);
  /** The header row the mapping was made for (Back then Next keeps the choices made for it). */
  const [mappedRow, setMappedRow] = useState<number | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  /** "Review companies": the company to use instead of a file's name, by the name in lower case. */
  const [companyMap, setCompanyMap] = useState<Record<string, string>>({});
  const [statusMap, setStatusMap] = useState<Record<string, ApplicationStatus>>({});
  /** "Map job types", by the file's text in lower case. */
  const [jobTypeMap, setJobTypeMap] = useState<Record<string, JobTypeChoice>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failedBatch, setFailedBatch] = useState<FailedBatch | null>(null);
  const [outcome, setOutcome] = useState<{ imported: number; notImported: NotImported[]; stopped: boolean } | null>(null);
  /** What the batches sent so far added and left out (kept across Retry and Skip). */
  const tally = useRef<{ imported: number; notImported: NotImported[] }>({ imported: 0, notImported: [] });
  /** A run of batches is in flight. */
  const running = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setStep('file');
    setFileName('');
    setTable([]);
    setHeaderRow(0);
    setMapping(null);
    setMappedRow(null);
    setShowOptional(false);
    setCompanyMap({});
    setStatusMap({});
    setJobTypeMap({});
    setProgress({ done: 0, total: 0 });
    setFailedBatch(null);
    setOutcome(null);
    tally.current = { imported: 0, notImported: [] };
    setProblem(null);
  };

  const headers = table[headerRow] ?? [];
  // The data rows, and each one's row number in the file (the spreadsheet's numbering, for the summary).
  const data = useMemo(() => {
    const out: { rows: string[][]; lines: number[] } = { rows: [], lines: [] };
    table.forEach((row, index) => {
      if (index <= headerRow || !row.some((cell) => cell.trim())) return;
      out.rows.push(row);
      out.lines.push(index + 1);
    });
    return out;
  }, [table, headerRow]);
  const dataRows = data.rows;
  const rows = useMemo(() => (mapping ? mappedRows(dataRows, mapping) : []), [dataRows, mapping]);
  const unknownStatuses = useMemo(() => unmappedStatusTexts(rows), [rows]);
  const unknownJobTypes = useMemo(
    () => distinctTexts(rows.map((row) => row.employmentType)).filter((text) => mapJobTypeText(text) === null),
    [rows],
  );

  // Which of the file's companies TailorIT knows (the account's or the job board's), asked once the columns are mapped.
  const companyNames = useMemo(() => distinctTexts(rows.map((row) => row.companyName)), [rows]);
  const companyCheck = useQuery({
    queryKey: ['tracker', 'import-companies', companyNames.join('\n')],
    queryFn: async () => {
      const known: Record<string, string> = {};
      for (let at = 0; at < companyNames.length; at += NAMES_PER_CHECK) {
        Object.assign(known, (await trackerApi.knownCompanies(companyNames.slice(at, at + NAMES_PER_CHECK))).known);
      }
      return known;
    },
    enabled: open && mapping !== null && companyNames.length > 0,
    staleTime: Infinity,
    retry: false,
  });
  // The review is a convenience: if the check fails, the file's names are imported as they are.
  const unknownCompanies = useMemo(
    () => (companyCheck.data ? companyNames.filter((name) => !Object.hasOwn(companyCheck.data, name)) : []),
    [companyCheck.data, companyNames],
  );
  const checkingCompanies = companyCheck.isLoading;

  /** The rows as the import receives them: the review choices applied. */
  const prepared = useMemo(
    () =>
      rows.map((row) => {
        const company = row.companyName?.trim();
        const rename = company ? companyMap[company.toLowerCase()]?.trim() : undefined;
        const type = row.employmentType?.trim();
        const choice = type ? jobTypeMap[type.toLowerCase()] : undefined;
        if (!rename && (!choice || choice === 'guess')) return row;
        return {
          ...row,
          ...(rename ? { companyName: rename.slice(0, CELL_LIMIT.companyName) } : {}),
          ...(choice && choice !== 'guess' ? { employmentType: EMPLOYMENT_TYPE_LABEL[choice] } : {}),
        };
      }),
    [rows, companyMap, jobTypeMap],
  );

  const needed: Record<ReviewStep, boolean> = {
    companies: unknownCompanies.length > 0,
    statuses: unknownStatuses.length > 0,
    jobTypes: unknownJobTypes.length > 0,
  };
  /** The review step after `from`, or null when the import comes next. */
  const reviewAfter = (from: 'map' | ReviewStep): ReviewStep | null =>
    (from === 'map' ? REVIEW_STEPS : REVIEW_STEPS.slice(REVIEW_STEPS.indexOf(from) + 1)).find((next) => needed[next]) ?? null;
  const reviewBefore = (from: ReviewStep): 'map' | ReviewStep =>
    [...REVIEW_STEPS.slice(0, REVIEW_STEPS.indexOf(from))].reverse().find((previous) => needed[previous]) ?? 'map';
  /** A row number, or a range, as the file numbers them. */
  const rowsLabel = (from: number, to: number) => {
    const first = data.lines[from] ?? from + 1;
    const last = data.lines[to] ?? to + 1;
    return from === to ? `Row ${first}` : `Rows ${first}–${last}`;
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setProblem('Please choose a CSV file.');
      return;
    }
    try {
      const parsed = await readFile(file);
      if (parsed.length < 2) {
        setProblem('That file has no rows to import.');
        return;
      }
      if (parsed.length - 1 > MAX_ROWS) {
        setProblem(`That file has more than ${MAX_ROWS} rows. Split it and import the parts one at a time.`);
        return;
      }
      setFileName(file.name);
      setTable(parsed);
      setHeaderRow(0);
      setStep('header');
    } catch {
      setProblem("We couldn't read that file. Check that it is a CSV file and try again.");
    }
  };

  const startMapping = () => {
    if (mapping && mappedRow === headerRow) {
      setStep('map');
      return;
    }
    const guess = guessImportMapping(headers);
    const next = {} as Record<TrackerImportField, Mapping>;
    for (const { key } of TRACKER_IMPORT_FIELDS) {
      const index = guess[key];
      next[key] = index === undefined ? { kind: 'none' } : { kind: 'column', index };
    }
    setMapping(next);
    setMappedRow(headerRow);
    setShowOptional(TRACKER_IMPORT_FIELDS.some((field) => !field.required && next[field.key].kind !== 'none'));
    setStep('map');
  };

  const requiredMissing =
    !mapping ||
    TRACKER_IMPORT_FIELDS.some((field) => {
      if (!field.required) return false;
      const map = mapping[field.key];
      return map.kind === 'none' || (map.kind === 'custom' && !map.value.trim());
    });

  const finish = (stopped: boolean) => {
    setOutcome({ imported: tally.current.imported, notImported: [...tally.current.notImported], stopped });
    setFailedBatch(null);
    setStep('done');
  };

  /**
   * Sends the rows from `start` on, a batch at a time. Each batch is written whole or not at all, so a failed one can
   * be sent again safely; the import then waits for Retry, Skip these rows or Stop import.
   */
  const importFrom = async (start: number) => {
    // One run at a time: a second Retry click must not send the same rows twice.
    if (running.current) return;
    running.current = true;
    setStep('importing');
    setFailedBatch(null);
    setProblem(null);
    const total = prepared.length;
    try {
      for (let at = start; at < total; at += CHUNK) {
        setProgress({ done: at, total });
        const end = Math.min(total, at + CHUNK);
        try {
          const answer = await trackerApi.import({ rows: prepared.slice(at, end), statusMap });
          tally.current.imported += answer.imported;
          for (const error of answer.errors) {
            const index = at + error.row - 1;
            tally.current.notImported.push({ from: index, to: index, message: error.message });
          }
        } catch (error) {
          setFailedBatch({ start: at, end, message: userMessage(error, "We couldn't import these rows. Please try again.") });
          return;
        }
      }
      setProgress({ done: total, total });
      finish(false);
    } finally {
      running.current = false;
      void invalidateApplications(client);
    }
  };

  const startImport = () => {
    tally.current = { imported: 0, notImported: [] };
    void importFrom(0);
  };

  const skipBatch = (batch: FailedBatch) => {
    if (running.current) return;
    tally.current.notImported.push({ from: batch.start, to: batch.end - 1, message: batch.message });
    void importFrom(batch.end);
  };

  const stopImport = (batch: FailedBatch) => {
    if (running.current) return;
    tally.current.notImported.push({
      from: batch.start,
      to: prepared.length - 1,
      message: 'Not imported: the import was stopped.',
    });
    finish(true);
  };

  /** Next from "Map your columns" or a review step: the next review the file needs, else the import. */
  const advance = (from: 'map' | ReviewStep) => {
    const next = reviewAfter(from);
    if (next) setStep(next);
    else startImport();
  };
  const advanceLabel = (from: 'map' | ReviewStep) => (reviewAfter(from) ? 'Next' : `Import ${prepared.length} applications`);

  const columnOptions = (field: TrackerImportField) => [
    ...(TRACKER_IMPORT_FIELDS.find((item) => item.key === field)?.required ? [] : [{ value: 'none', label: "Don't import" }]),
    ...headers.map((_, index) => ({ value: `column:${index}`, label: columnName(headers, index) })),
    { value: 'custom', label: 'Custom value' },
  ];
  const mappingValue = (map: Mapping) => (map.kind === 'column' ? `column:${map.index}` : map.kind);
  const setField = (field: TrackerImportField, value: string) =>
    setMapping((current) => {
      if (!current) return current;
      const next: Mapping =
        value === 'none'
          ? { kind: 'none' }
          : value === 'custom'
            ? { kind: 'custom', value: '' }
            : { kind: 'column', index: Number(value.split(':')[1]) };
      return { ...current, [field]: next };
    });

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files?.[0]);
  };

  const preview = rows.slice(0, 3);
  const shownFields = TRACKER_IMPORT_FIELDS.filter((field) => field.required || showOptional);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Batches in flight finish first; a failed one waiting for Retry or Skip can be left.
        if (!next && step === 'importing' && !failedBatch) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent title="Import Applications from CSV" size="xl" className="sm:max-w-3xl">
        <div className="mt-5 flex min-h-0 flex-col gap-4 overflow-y-auto">
          {step === 'file' && (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={clsx(
                'flex flex-col items-center justify-center gap-3 rounded-surface border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragging ? 'border-primary-ink bg-primary/5' : 'border-control-strong bg-surface-low',
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-container text-primary-ink">
                <FileCsvIcon size={24} />
              </span>
              <Button icon={<UploadSimpleIcon size={16} />} onClick={() => input.current?.click()}>
                Choose CSV File
              </Button>
              <p className="text-sm text-muted-foreground">Expected headers: Company name, Position Title. Location is optional.</p>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="CSV file"
                tabIndex={-1}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>
          )}

          {step === 'header' && (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span>: {table.length} rows. Which row holds the column names?
              </p>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Header row
                <Select
                  aria-label="Header row"
                  className="w-full"
                  value={String(headerRow)}
                  onValueChange={(value) => setHeaderRow(Number(value))}
                  options={table.slice(0, HEADER_CHOICES).map((row, index) => ({
                    value: String(index),
                    label: `Row ${index + 1}: ${row.filter(Boolean).slice(0, 4).join(', ') || '(empty)'}`,
                  }))}
                />
              </label>
              <PreviewTable rows={table.slice(0, 6)} highlight={headerRow} />
            </>
          )}

          {step === 'map' && mapping && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">Map your columns</h3>
                <span className="text-sm text-muted-foreground">{dataRows.length} rows</span>
              </div>
              <div className="flex flex-col gap-3">
                {shownFields.map((field) => {
                  const map = mapping[field.key];
                  return (
                    <div key={field.key} className="grid items-center gap-2 sm:grid-cols-[11rem_1fr_1fr]">
                      <span className="text-sm font-medium text-foreground">
                        {field.label}
                        {field.required && <span className="ml-0.5 text-[#c62a29]">*</span>}
                      </span>
                      <Select
                        aria-label={`${field.label} column`}
                        className="w-full"
                        options={columnOptions(field.key)}
                        value={map.kind === 'none' && field.required ? null : mappingValue(map)}
                        placeholder="Choose a column"
                        onValueChange={(value) => setField(field.key, value)}
                      />
                      {map.kind === 'custom' ? (
                        <Input
                          aria-label={`${field.label} custom value`}
                          placeholder="Value for every row"
                          value={map.value}
                          onChange={(event) =>
                            setMapping((current) => (current ? { ...current, [field.key]: { kind: 'custom', value: event.target.value } } : current))
                          }
                        />
                      ) : (
                        <span className="truncate text-sm text-muted-foreground">
                          {map.kind === 'column' ? `e.g. ${(dataRows[0]?.[map.index] ?? '').trim() || '(empty)'}` : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setShowOptional((value) => !value)}
                className="self-start text-sm font-medium text-primary-ink hover:underline"
              >
                {showOptional ? 'Hide optional fields' : 'Show optional fields'}
              </button>
              {preview.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-foreground">Preview</span>
                  <PreviewTable
                    rows={[
                      shownFields.map((field) => field.label),
                      ...preview.map((row) => shownFields.map((field) => row[field.key] ?? '')),
                    ]}
                    highlight={0}
                  />
                </div>
              )}
            </>
          )}

          {step === 'companies' && (
            <>
              <h3 className="text-base font-semibold text-foreground">Review companies</h3>
              <p className="text-sm text-muted-foreground">
                These companies are new to TailorIT. Pick the one you mean from the suggestions, or keep the name to add it
                as a new company.
              </p>
              <div className="flex flex-col gap-3">
                {unknownCompanies.slice(0, MAX_COMPANY_REVIEW).map((name, index) => {
                  const key = name.toLowerCase();
                  return (
                    <div key={key} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
                      <FieldLabel htmlFor={`import-company-${index}`} className="block truncate">
                        {name}
                      </FieldLabel>
                      <CompanyInput
                        id={`import-company-${index}`}
                        lazy
                        value={companyMap[key] ?? name}
                        onValueChange={(value) => setCompanyMap((current) => ({ ...current, [key]: value }))}
                      />
                    </div>
                  );
                })}
              </div>
              {unknownCompanies.length > MAX_COMPANY_REVIEW && (
                <p className="text-sm text-muted-foreground">
                  {unknownCompanies.length - MAX_COMPANY_REVIEW} more companies keep the names in the file.
                </p>
              )}
            </>
          )}

          {step === 'statuses' && (
            <>
              <h3 className="text-base font-semibold text-foreground">Map status values</h3>
              <p className="text-sm text-muted-foreground">Choose the tracker status for each value in your file.</p>
              <div className="flex flex-col gap-3">
                {unknownStatuses.map((text) => (
                  <div key={text} className="grid items-center gap-2 sm:grid-cols-[1fr_14rem]">
                    <span className="truncate text-sm font-medium text-foreground">&ldquo;{text}&rdquo;</span>
                    <Select
                      aria-label={`Status for ${text}`}
                      className="w-full"
                      options={statusOptions()}
                      value={String(statusMap[text] ?? STATUS.applied)}
                      onValueChange={(value) => setStatusMap((current) => ({ ...current, [text]: Number(value) as ApplicationStatus }))}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'jobTypes' && (
            <>
              <h3 className="text-base font-semibold text-foreground">Map job types</h3>
              <p className="text-sm text-muted-foreground">Choose the job type for each value in your file.</p>
              <div className="flex flex-col gap-3">
                {unknownJobTypes.map((text) => (
                  <div key={text.toLowerCase()} className="grid items-center gap-2 sm:grid-cols-[1fr_14rem]">
                    <span className="truncate text-sm font-medium text-foreground">&ldquo;{text}&rdquo;</span>
                    <Select
                      aria-label={`Job type for ${text}`}
                      className="w-full"
                      options={JOB_TYPE_CHOICES}
                      value={jobTypeMap[text.toLowerCase()] ?? 'guess'}
                      onValueChange={(value) => setJobTypeMap((current) => ({ ...current, [text.toLowerCase()]: value }))}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center gap-3 py-10" role="status">
              {failedBatch ? (
                <WarningCircleIcon size={28} weight="fill" className="text-amber-foreground" />
              ) : (
                <Spinner size={24} />
              )}
              <p className="text-sm font-medium text-foreground">{failedBatch ? 'Import paused' : 'Processing rows...'}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {progress.done} of {progress.total}
              </p>
            </div>
          )}
          {step === 'importing' && failedBatch && (
            <Notice tone="error">
              {rowsLabel(failedBatch.start, failedBatch.end - 1)} couldn&rsquo;t be imported: {failedBatch.message} Retry them,
              skip them, or stop the import here.
            </Notice>
          )}

          {step === 'done' && outcome && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              {outcome.notImported.length > 0 ? (
                <span className="flex size-12 items-center justify-center rounded-full bg-amber text-amber-foreground">
                  <WarningCircleIcon size={26} weight="fill" />
                </span>
              ) : (
                <span className="flex size-12 items-center justify-center rounded-full bg-success-container text-success">
                  <CheckCircleIcon size={26} weight="fill" />
                </span>
              )}
              <h3 className="text-lg font-semibold text-foreground">{outcome.stopped ? 'Import Stopped' : 'Import Complete'}</h3>
              {outcome.notImported.length === 0 ? (
                <p className="text-sm text-muted-foreground">All {outcome.imported} applications imported successfully!</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {outcome.imported} of {prepared.length} applications imported. These rows were not imported:
                  </p>
                  <ul
                    aria-label="Rows not imported"
                    className="max-h-40 w-full overflow-y-auto rounded-control border border-border bg-surface-low p-3 text-left text-sm"
                  >
                    {outcome.notImported.slice(0, 200).map((entry) => (
                      <li key={`${entry.from}-${entry.to}`}>
                        <span className="font-medium">{rowsLabel(entry.from, entry.to)}:</span> {entry.message}
                      </li>
                    ))}
                  </ul>
                  {outcome.notImported.length > 200 && (
                    <p className="text-sm text-muted-foreground">…and {outcome.notImported.length - 200} more.</p>
                  )}
                </>
              )}
            </div>
          )}

          {problem && <Notice tone="error">{problem}</Notice>}
        </div>

        <DialogFooter>
          {step === 'header' && (
            <>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button onClick={startMapping}>Next</Button>
            </>
          )}
          {step === 'map' && (
            <>
              <Button variant="outline" onClick={() => setStep('header')}>
                Back
              </Button>
              <Button
                disabled={requiredMissing || rows.length === 0}
                loading={checkingCompanies && !requiredMissing}
                onClick={() => advance('map')}
              >
                {advanceLabel('map')}
              </Button>
            </>
          )}
          {(step === 'companies' || step === 'statuses' || step === 'jobTypes') && (
            <>
              <Button variant="outline" onClick={() => setStep(reviewBefore(step))}>
                Back
              </Button>
              <Button onClick={() => advance(step)}>{advanceLabel(step)}</Button>
            </>
          )}
          {step === 'importing' && failedBatch && (
            <>
              <Button variant="outline" onClick={() => stopImport(failedBatch)}>
                Stop import
              </Button>
              <Button variant="outline" onClick={() => skipBatch(failedBatch)}>
                Skip these rows
              </Button>
              <Button onClick={() => void importFrom(failedBatch.start)}>Retry</Button>
            </>
          )}
          {step === 'done' && (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTable({ rows, highlight }: { rows: readonly (readonly string[])[]; highlight: number }) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={clsx('border-b border-border last:border-b-0', rowIndex === highlight && 'bg-surface-low font-semibold')}>
              {Array.from({ length: width }, (_, cell) => (
                <td key={cell} className="max-w-48 truncate px-3 py-2">
                  {row[cell] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

