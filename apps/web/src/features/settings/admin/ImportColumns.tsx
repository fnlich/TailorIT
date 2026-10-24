'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, FieldLabel } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { userMessage } from '@/lib/api';
import { AdminTable, runCounts, type AdminColumn } from './parts';
import type { ImportField, ImportMapping, ImportPreview, ImportResult } from './types';

const NONE = '__none';
const SAMPLE_FIELDS: readonly ImportField[] = ['title', 'company', 'url', 'location', 'postedAt'];

export interface ImportColumnsProps {
  preview: ImportPreview;
  /** The mapping shown (the preview's, or the one just chosen while its preview loads). */
  mapping: ImportMapping;
  onRemap: (field: ImportField, column: string | null) => void;
  /** The count line's ending: "CSV", "JSON", "Google Sheet". */
  countLabel: string;
  /** The accessible name of the first-rows table ("First rows of the file"). */
  sampleLabel: string;
  /** "Not in this file", "Not in this tab". */
  noneLabel: string;
  /** Fields whose column cannot be chosen now, with what the select shows instead. */
  disabledFields?: Partial<Record<ImportField, string>>;
  name: string;
  onNameChange: (value: string) => void;
  onNameBlur?: () => void;
  namePlaceholder: string;
  nameHint: ReactNode;
  importing: boolean;
  importDisabled: boolean;
  onImport: () => void;
  /** Shown at the top of the columns card. */
  notices?: ReactNode;
}

/**
 * The second step of an import: which column holds which field, the rows that will be skipped, the first rows, and
 * the source name with the Import button. Shared by the file and the Google Sheet imports.
 */
export function ImportColumns({
  preview,
  mapping,
  onRemap,
  countLabel,
  sampleLabel,
  noneLabel,
  disabledFields,
  name,
  onNameChange,
  onNameBlur,
  namePlaceholder,
  nameHint,
  importing,
  importDisabled,
  onImport,
  notices,
}: ImportColumnsProps) {
  const missing = preview.fields.filter((field) => field.required && !mapping[field.field]);
  const sampleColumns: AdminColumn<Record<string, string>>[] = SAMPLE_FIELDS.filter((field) => mapping[field]).map((field) => ({
    key: field,
    header: preview.fields.find((entry) => entry.field === field)?.label ?? field,
    cell: (row: Record<string, string>) => <span className="line-clamp-2 break-all">{row[mapping[field]!] || '-'}</span>,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">Columns</h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {preview.rowCount} rows, {preview.jobCount} {preview.jobCount === 1 ? 'job' : 'jobs'} to import ({countLabel})
          </p>
        </div>
        {notices && <div className="mt-4 flex flex-col gap-3">{notices}</div>}
        <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {preview.fields.map((field) => {
            const disabled = disabledFields?.[field.field];
            return (
              <div key={field.field} className="flex flex-col gap-1.5">
                <FieldLabel required={field.required}>{field.label}</FieldLabel>
                <Select
                  aria-label={field.label}
                  options={[{ value: NONE, label: noneLabel }, ...preview.columns.map((column) => ({ value: column, label: column }))]}
                  value={disabled ? null : (mapping[field.field] ?? NONE)}
                  placeholder={disabled}
                  disabled={Boolean(disabled)}
                  onValueChange={(column) => onRemap(field.field, column === NONE ? null : column)}
                />
              </div>
            );
          })}
        </div>
        {missing.length > 0 && (
          <Notice tone="warning" className="mt-5">
            Choose the column for {missing.map((field) => field.label.toLowerCase()).join(', ')}.
          </Notice>
        )}
        {preview.problems.length > 0 && (
          <Notice tone="warning" className="mt-5" title="Some rows will be skipped">
            <ul className="list-disc pl-5">
              {preview.problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {preview.problems.length > 8 && <p className="mt-1">And {preview.problems.length - 8} more.</p>}
          </Notice>
        )}
      </div>

      {sampleColumns.length > 0 && preview.sample.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-foreground">First rows</h3>
          <AdminTable aria-label={sampleLabel} items={preview.sample} columns={sampleColumns} getKey={(row) => preview.sample.indexOf(row)} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 rounded-surface border border-border bg-surface p-6 shadow-soft">
        <Field label="Source name" optional hint={nameHint} className="min-w-64 flex-1">
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} onBlur={onNameBlur} placeholder={namePlaceholder} />
        </Field>
        <Button onClick={onImport} loading={importing} disabled={missing.length > 0 || preview.jobCount === 0 || importDisabled}>
          Import {preview.jobCount} {preview.jobCount === 1 ? 'job' : 'jobs'}
        </Button>
      </div>
    </div>
  );
}

/** How an import went: the run's counts, or that it continues in the background; a failure's sentence. */
export function ImportResultNotice({
  result,
  error,
  noun,
  onShowRuns,
}: {
  result: ImportResult | null;
  error: unknown;
  /** What was imported: "file" or "tab". */
  noun: 'file' | 'tab';
  onShowRuns: (sourceId: number) => void;
}) {
  return (
    <>
      {error ? (
        <Notice tone="error" className="mt-6">
          {userMessage(error)}
        </Notice>
      ) : null}
      {result && (
        <Notice
          tone={!result.run ? 'info' : result.run.status === 'failed' ? 'error' : result.run.status === 'partial' ? 'warning' : 'success'}
          className="mt-6"
          title={
            !result.run
              ? `Importing into ${result.source.name}`
              : result.run.status === 'failed'
                ? 'The import failed'
                : `Imported into ${result.source.name}`
          }
          action={
            <Button variant="outline" size="sm" onClick={() => onShowRuns(result.source.id)}>
              See the run
            </Button>
          }
        >
          {!result.run
            ? noun === 'file'
              ? 'This file is large, so it is importing in the background. Its run shows the progress.'
              : 'This tab is importing in the background. Its run shows the progress.'
            : (result.run.error ?? `${runCounts(result.run)}. ${result.source.activeJobCount} live jobs from this ${noun}.`)}
        </Notice>
      )}
    </>
  );
}
