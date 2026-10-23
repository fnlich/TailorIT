'use client';

import { FileCsvIcon } from '@phosphor-icons/react/FileCsv';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  STATUS,
  TRACKER_IMPORT_FIELDS,
  guessImportMapping,
  unmappedStatusTexts,
  type ApplicationStatus,
  type TrackerImportField,
  type TrackerImportResponse,
  type TrackerImportRowInput,
} from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { CheckCircleIcon, UploadSimpleIcon, WarningCircleIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import { invalidateApplications, trackerApi } from '../data';
import { statusOptions } from '../status';

type Step = 'file' | 'header' | 'map' | 'statuses' | 'importing' | 'done';

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
 * six optional, any of them a custom value), map status words the import does not know, then import in batches.
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
  const [statusMap, setStatusMap] = useState<Record<string, ApplicationStatus>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<TrackerImportResponse | null>(null);
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
    setStatusMap({});
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setProblem(null);
  };

  const headers = table[headerRow] ?? [];
  const dataRows = useMemo(() => table.slice(headerRow + 1).filter((row) => row.some((cell) => cell.trim())), [table, headerRow]);
  const rows = useMemo(() => (mapping ? mappedRows(dataRows, mapping) : []), [dataRows, mapping]);
  const unknownStatuses = useMemo(() => unmappedStatusTexts(rows), [rows]);

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

  const runImport = async () => {
    setStep('importing');
    setProblem(null);
    const total = rows.length;
    setProgress({ done: 0, total });
    const summary: TrackerImportResponse = { imported: 0, skipped: 0, errors: [] };
    try {
      for (let start = 0; start < total; start += CHUNK) {
        const chunk = rows.slice(start, start + CHUNK);
        const answer = await trackerApi.import({ rows: chunk, statusMap });
        summary.imported += answer.imported;
        summary.skipped += answer.skipped;
        summary.errors.push(...answer.errors.map((error) => ({ row: error.row + start, message: error.message })));
        setProgress({ done: Math.min(total, start + chunk.length), total });
      }
      setResult(summary);
      setStep('done');
    } catch (error) {
      setResult(summary.imported > 0 ? summary : null);
      setProblem(userMessage(error, "We couldn't finish the import. Please try again."));
      setStep(summary.imported > 0 ? 'done' : 'map');
    } finally {
      void invalidateApplications(client);
    }
  };

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
        if (!next && step === 'importing') return;
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

          {step === 'importing' && (
            <div className="flex flex-col items-center gap-3 py-10" role="status">
              <Spinner size={24} />
              <p className="text-sm font-medium text-foreground">Processing rows...</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {progress.done} of {progress.total}
              </p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              {problem ? (
                <span className="flex size-12 items-center justify-center rounded-full bg-amber text-amber-foreground">
                  <WarningCircleIcon size={26} weight="fill" />
                </span>
              ) : (
                <span className="flex size-12 items-center justify-center rounded-full bg-success-container text-success">
                  <CheckCircleIcon size={26} weight="fill" />
                </span>
              )}
              <h3 className="text-lg font-semibold text-foreground">{problem ? 'Import Stopped' : 'Import Complete'}</h3>
              {problem ? (
                <p className="text-sm text-muted-foreground">
                  {result.imported} applications were imported before the import stopped. Remove those rows from the file before
                  importing the rest, so they are not added twice.
                </p>
              ) : result.errors.length === 0 ? (
                <p className="text-sm text-muted-foreground">All {result.imported} applications imported successfully!</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {result.imported} of {result.imported + result.skipped} applications imported. These rows were skipped:
                  </p>
                  <ul className="max-h-40 w-full overflow-y-auto rounded-control border border-border bg-surface-low p-3 text-left text-sm">
                    {result.errors.slice(0, 200).map((error) => (
                      <li key={`${error.row}-${error.message}`}>
                        <span className="font-medium">Row {error.row + headerRow + 1}:</span> {error.message}
                      </li>
                    ))}
                  </ul>
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
                onClick={() => (unknownStatuses.length > 0 ? setStep('statuses') : void runImport())}
              >
                {unknownStatuses.length > 0 ? 'Next' : `Import ${rows.length} applications`}
              </Button>
            </>
          )}
          {step === 'statuses' && (
            <>
              <Button variant="outline" onClick={() => setStep('map')}>
                Back
              </Button>
              <Button onClick={() => void runImport()}>Import {rows.length} applications</Button>
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

