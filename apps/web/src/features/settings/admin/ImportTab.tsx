'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FileTextIcon, UploadSimpleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl, TabPanel } from '@/components/ui/SegmentedControl';
import { userMessage } from '@/lib/api';
import { adminKeys, fetchSources, importJobs, previewImport } from './api';
import { ImportColumns, ImportResultNotice } from './ImportColumns';
import { SectionHeader } from './parts';
import { SheetImport, type SheetPrefill } from './SheetImport';
import { sheetOf } from './sources';
import type { AdminSource, ImportField, ImportMapping, ImportPreview, ImportResult } from './types';

type ImportMode = 'file' | 'sheet';

const MODES: ReadonlyArray<{ value: ImportMode; label: string }> = [
  { value: 'file', label: 'File' },
  { value: 'sheet', label: 'Google Sheet' },
];

/** The settings of a Google Sheet source to read again, or null (not a sheet source, or not loaded yet). */
function prefillOf(sourceId: number | null, sources: readonly AdminSource[] | undefined): SheetPrefill | null {
  if (sourceId === null || !sources) return null;
  const source = sources.find((item) => item.id === sourceId);
  const sheet = source ? sheetOf(source) : null;
  if (!source || !sheet) return null;
  return { sourceId: source.id, url: sheet.url, gid: sheet.gid, headerRow: sheet.headerRow, postedAtFromTab: sheet.postedAt !== null, name: source.name };
}

/**
 * Admin > Import jobs: postings from a CSV or JSON file, or from one tab of a Google Sheet (read once, never written).
 * `sourceId` (Sources > Import the sheet again) opens the Google Sheet mode with that source's tab and settings.
 */
export function ImportTab({ sourceId = null, onShowRuns }: { sourceId?: number | null; onShowRuns: (sourceId: number) => void }) {
  const [chosenMode, setChosenMode] = useState<ImportMode | null>(null);
  const sources = useQuery({ queryKey: adminKeys.sources, queryFn: ({ signal }) => fetchSources(signal), enabled: sourceId !== null });
  const prefill = useMemo(() => prefillOf(sourceId, sources.data?.items), [sourceId, sources.data]);
  const waiting = sourceId !== null && sources.isPending;
  const mode = chosenMode ?? (prefill || waiting ? 'sheet' : 'file');

  return (
    <section>
      <SectionHeader
        title="Import jobs"
        description="Add postings from a CSV or JSON file, or from a tab of a Google Sheet. Each file or tab becomes a source; importing it again under the same name updates it."
      />
      <SegmentedControl aria-label="Import from" items={MODES} value={mode} onValueChange={setChosenMode}>
        <TabPanel value="file" keepMounted className="mt-5">
          <FileImport onShowRuns={onShowRuns} />
        </TabPanel>
        <TabPanel value="sheet" keepMounted className="mt-5">
          <SheetImport key={prefill ? `source-${prefill.sourceId}` : 'sheet'} prefill={prefill} onShowRuns={onShowRuns} />
        </TabPanel>
      </SegmentedControl>
    </section>
  );
}

/**
 * A CSV or JSON file of postings (free_tailor's job sheet columns are recognised: Date, Company, Job Title, Job Link,
 * Job Description). Choose the file, check which column is which, then import it as a source.
 */
function FileImport({ onShowRuns }: { onShowRuns: (sourceId: number) => void }) {
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

  const remap = (field: ImportField, column: string | null) => {
    if (!mapping || !file) return;
    const next = { ...mapping, [field]: column };
    setMapping(next);
    read.mutate({ chosen: file, map: next });
  };

  return (
    <div>
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
        <div className="mt-6">
          <ImportColumns
            preview={preview}
            mapping={mapping}
            onRemap={remap}
            countLabel={preview.format.toUpperCase()}
            sampleLabel="First rows of the file"
            noneLabel="Not in this file"
            name={name}
            onNameChange={setName}
            namePlaceholder={preview.fileName}
            nameHint={`Defaults to ${preview.fileName}.`}
            importing={save.isPending}
            importDisabled={read.isPending}
            onImport={() => save.mutate()}
          />
        </div>
      )}

      <ImportResultNotice result={result} error={save.error} noun="file" onShowRuns={onShowRuns} />
    </div>
  );
}
