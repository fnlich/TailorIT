'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, FieldLabel } from '@/components/ui/Field';
import { FileTextIcon, UploadSimpleIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { userMessage } from '@/lib/api';
import { adminKeys, importJobs, previewImport } from './api';
import { AdminTable, runCounts, SectionHeader, type AdminColumn } from './parts';
import type { ImportField, ImportMapping, ImportPreview, ImportResult } from './types';

const NONE = '__none';
const SAMPLE_FIELDS: readonly ImportField[] = ['title', 'company', 'url', 'location', 'postedAt'];

/**
 * Admin > Import jobs: a CSV or JSON file of postings (free_tailor's job sheet columns are recognised: Date, Company,
 * Job Title, Job Link, Job Description). Choose the file, check which column is which, then import it as a source.
 */
export function ImportTab({ onShowRuns }: { onShowRuns: (sourceId: number) => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = useMutation({
    mutationFn: ({ chosen, map }: { chosen: File; map?: ImportMapping }) => previewImport(chosen, map),
    onSuccess: (answer) => {
      setPreview(answer);
      setMapping(answer.mapping);
    },
  });

  const save = useMutation({
    mutationFn: () => importJobs(file!, mapping!, name),
    onSuccess: (answer) => {
      setResult(answer);
      void queryClient.invalidateQueries({ queryKey: adminKeys.sources });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'runs'] });
    },
  });

  const choose = (chosen: File | null) => {
    setResult(null);
    setPreview(null);
    setMapping(null);
    save.reset();
    setFile(chosen);
    if (chosen) read.mutate({ chosen });
  };

  const remap = (field: ImportField, column: string) => {
    if (!mapping || !file) return;
    const next = { ...mapping, [field]: column === NONE ? null : column };
    setMapping(next);
    read.mutate({ chosen: file, map: next });
  };

  const missing = preview ? preview.fields.filter((field) => field.required && !mapping?.[field.field]) : [];
  const sampleColumns: AdminColumn<Record<string, string>>[] = preview
    ? SAMPLE_FIELDS.filter((field) => mapping?.[field]).map((field) => ({
        key: field,
        header: preview.fields.find((entry) => entry.field === field)?.label ?? field,
        cell: (row: Record<string, string>) => <span className="line-clamp-2 break-all">{row[mapping![field]!] || '-'}</span>,
      }))
    : [];

  return (
    <section>
      <SectionHeader
        title="Import jobs"
        description="Add postings from a CSV or JSON file. Each file becomes a source; importing a file with the same name again updates it."
      />
      <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.json,text/csv,application/json"
          className="sr-only"
          aria-label="Job file"
          data-testid="import-file"
          onChange={(event) => {
            choose(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-container text-primary-ink">
            {file ? <FileTextIcon size={22} /> : <UploadSimpleIcon size={22} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{file ? file.name : 'Choose a CSV or JSON file'}</p>
            <p className="text-sm text-muted-foreground">
              {file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : 'One posting per row (CSV) or per object (JSON). Up to 5 MB.'}
            </p>
          </div>
          <Button variant={file ? 'outline' : 'primary'} icon={<UploadSimpleIcon size={16} />} onClick={() => inputRef.current?.click()}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
        </div>
        {read.isError && (
          <Notice tone="error" className="mt-5">
            {userMessage(read.error)}
          </Notice>
        )}
      </div>

      {preview && mapping && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">Columns</h3>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {preview.rowCount} rows, {preview.jobCount} {preview.jobCount === 1 ? 'job' : 'jobs'} to import ({preview.format.toUpperCase()})
              </p>
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {preview.fields.map((field) => (
                <div key={field.field} className="flex flex-col gap-1.5">
                  <FieldLabel required={field.required}>{field.label}</FieldLabel>
                  <Select
                    aria-label={field.label}
                    options={[{ value: NONE, label: 'Not in this file' }, ...preview.columns.map((column) => ({ value: column, label: column }))]}
                    value={mapping[field.field] ?? NONE}
                    onValueChange={(column) => remap(field.field, column)}
                  />
                </div>
              ))}
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
              <AdminTable aria-label="First rows of the file" items={preview.sample} columns={sampleColumns} getKey={(row) => preview.sample.indexOf(row)} />
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4 rounded-surface border border-border bg-surface p-6 shadow-soft">
            <Field label="Source name" optional hint={`Defaults to ${preview.fileName}.`} className="min-w-64 flex-1">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={preview.fileName} />
            </Field>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={missing.length > 0 || preview.jobCount === 0 || read.isPending}
            >
              Import {preview.jobCount} {preview.jobCount === 1 ? 'job' : 'jobs'}
            </Button>
          </div>
        </div>
      )}

      {save.isError && (
        <Notice tone="error" className="mt-6">
          {userMessage(save.error)}
        </Notice>
      )}
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
            ? 'This file is large, so it is importing in the background. Its run shows the progress.'
            : (result.run.error ?? `${runCounts(result.run)}. ${result.source.activeJobCount} live jobs from this file.`)}
        </Notice>
      )}
    </section>
  );
}
