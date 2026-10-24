'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SHEET_MAX_HEADER_ROW, parseSpreadsheetRef } from '@tailorit/shared/ingest';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { ArrowSquareOutIcon, CopyIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { isApiError, userMessage } from '@/lib/api';
import { adminKeys, fetchSheetAccount, importSheet, previewSheet } from './api';
import { ImportColumns, ImportResultNotice } from './ImportColumns';
import type { ImportField, ImportMapping, ImportResult, SheetImportBody, SheetPreview, SheetPreviewBody } from './types';

/** A sheet source's settings, to read its tab again (Sources > Import the sheet again). */
export interface SheetPrefill {
  sourceId: number;
  url: string;
  gid: number;
  headerRow: number;
  postedAtFromTab: boolean;
  name: string;
}

const HEADER_ROW_MESSAGE = `Choose a header row from 1 to ${SHEET_MAX_HEADER_ROW}.`;

interface ReadRequest {
  body: SheetPreviewBody;
  signal: AbortSignal;
  /** Answers to any but the latest read are dropped. */
  sequence: number;
}

/**
 * Admin > Import jobs > Google Sheet: a one-time, read-only import of one tab. Share the sheet with the service
 * account, paste its link, check the tab, header row and columns, then import. TailorIT never writes to the sheet.
 */
export function SheetImport({ prefill, onShowRuns }: { prefill: SheetPrefill | null; onShowRuns: (sourceId: number) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const account = useQuery({ queryKey: adminKeys.sheetAccount, queryFn: ({ signal }) => fetchSheetAccount(signal), staleTime: 60_000 });

  const [link, setLink] = useState(prefill?.url ?? '');
  const [linkTouched, setLinkTouched] = useState(false);
  const [name, setName] = useState(prefill?.name ?? '');
  const [checkedName, setCheckedName] = useState(prefill?.name ?? '');
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  /** Choices shown at once while the preview that answers them loads. */
  const [chosenMapping, setChosenMapping] = useState<ImportMapping | null>(null);
  const [chosenGid, setChosenGid] = useState<number | null>(null);
  const [fromTab, setFromTab] = useState<boolean | undefined>(prefill ? prefill.postedAtFromTab : undefined);
  const [headerText, setHeaderText] = useState(String(prefill?.headerRow ?? 1));
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const read = useMutation({
    mutationFn: ({ body, signal }: ReadRequest) => previewSheet(body, signal),
    onSuccess: (answer, request) => {
      if (request.sequence !== sequence.current) return;
      setPreview(answer);
      setChosenMapping(null);
      setChosenGid(null);
      setHeaderText(String(answer.headerRow));
      setReadError(null);
    },
    onError: (error, request) => {
      if (request.sequence !== sequence.current) return;
      setChosenMapping(null);
      setChosenGid(null);
      setReadError(error);
    },
  });
  const { mutate } = read;

  /** Asks for a preview; a newer one replaces (and cancels) the last. */
  const startRead = useCallback(
    (body: SheetPreviewBody) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      sequence.current += 1;
      mutate({ body, signal: controller.signal, sequence: sequence.current });
    },
    [mutate],
  );

  // "Import the sheet again": read the source's tab with its settings once.
  const prefilled = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || prefilled.current === prefill.sourceId) return;
    prefilled.current = prefill.sourceId;
    startRead({
      url: prefill.url,
      gid: prefill.gid,
      headerRow: prefill.headerRow,
      postedAtFromTab: prefill.postedAtFromTab,
      ...(prefill.name ? { name: prefill.name } : {}),
      refresh: true,
    });
  }, [prefill, startRead]);

  const save = useMutation({
    mutationFn: (body: SheetImportBody) => importSheet(body),
    onSuccess: (answer) => {
      setResult(answer);
      void queryClient.invalidateQueries({ queryKey: adminKeys.sources });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'runs'] });
    },
  });

  const configured = account.data?.configured === true;
  const ref = parseSpreadsheetRef(link);
  const reading = read.isPending;
  const readingSheet = reading && read.variables?.body.refresh !== false;
  const mapping = chosenMapping ?? preview?.mapping ?? null;
  const usesTabDate = preview ? (fromTab ?? preview.postedAtFromTab) && preview.tabDate !== null : false;
  const fields = isApiError(readError) ? (readError.fields ?? {}) : {};
  const linkError = fields.url ?? (linkTouched && link.trim() && !ref.ok ? ref.message : undefined);
  const tabError = preview ? fields.gid : undefined;
  const headerRowError = headerError ?? (preview ? fields.headerRow : undefined);
  const otherError = readError && !fields.url && !tabError && !headerRowError ? readError : null;
  const typedName = name.trim();
  const existing = preview?.existingSource ?? null;
  const nameTaken = Boolean(existing && !existing.sameSheet && (typedName || preview?.sourceName) === existing.name);

  /** A preview of the tab shown, changed as given (no new read of Google). */
  const remap = (changes: Partial<SheetPreviewBody>) => {
    if (!preview) return;
    startRead({
      url: link.trim(),
      gid: preview.tab.gid,
      headerRow: preview.headerRow,
      ...(fromTab === undefined ? {} : { postedAtFromTab: fromTab }),
      ...(mapping ? { mapping } : {}),
      ...(typedName ? { name: typedName } : {}),
      ...changes,
      refresh: false,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLinkTouched(true);
    if (!configured || !ref.ok) return;
    setResult(null);
    save.reset();
    setPreview(null);
    setChosenMapping(null);
    setChosenGid(null);
    setFromTab(undefined);
    setHeaderText('1');
    setHeaderError(null);
    setReadError(null);
    setCheckedName(typedName);
    startRead({ url: link.trim(), refresh: true, ...(typedName ? { name: typedName } : {}) });
  };

  const editLink = (value: string) => {
    setLink(value);
    if (!preview && !reading && !readError) return;
    // A new link starts over: drop the preview (and any answer still on its way).
    sequence.current += 1;
    inFlight.current?.abort();
    setPreview(null);
    setChosenMapping(null);
    setChosenGid(null);
    setFromTab(undefined);
    setHeaderText('1');
    setHeaderError(null);
    setReadError(null);
    setResult(null);
  };

  const chooseTab = (gid: number) => {
    if (!preview || gid === preview.tab.gid) return;
    setChosenGid(gid);
    setChosenMapping(null);
    setFromTab(undefined);
    setHeaderText('1');
    setHeaderError(null);
    startRead({ url: link.trim(), gid, refresh: true, ...(typedName ? { name: typedName } : {}) });
  };

  const applyHeaderRow = (text = headerText) => {
    const row = Number(text);
    if (!text.trim() || !Number.isInteger(row) || row < 1 || row > SHEET_MAX_HEADER_ROW) {
      setHeaderError(HEADER_ROW_MESSAGE);
      return;
    }
    setHeaderError(null);
    if (!preview || row === preview.headerRow) return;
    setHeaderText(String(row));
    setChosenMapping(null);
    // Other columns: the server guesses the mapping again.
    remap({ headerRow: row, mapping: undefined });
  };

  const changeMapping = (field: ImportField, column: string | null) => {
    if (!mapping) return;
    const next = { ...mapping, [field]: column };
    setChosenMapping(next);
    remap({ mapping: next });
  };

  const toggleTabDate = (checked: boolean) => {
    setFromTab(checked);
    remap({ postedAtFromTab: checked });
  };

  const checkName = () => {
    if (!preview || typedName === checkedName) return;
    setCheckedName(typedName);
    remap({ name: typedName || undefined });
  };

  const startImport = () => {
    if (!preview) return;
    setResult(null);
    save.mutate({
      url: link.trim(),
      gid: preview.tab.gid,
      headerRow: preview.headerRow,
      postedAtFromTab: preview.postedAtFromTab,
      mapping: preview.mapping,
      ...(typedName ? { name: typedName } : {}),
    });
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast.success('Address copied', "Paste it into the sheet's Share box.");
    } catch {
      toast.info('Copy this address', email);
    }
  };

  return (
    <div>
      {account.isPending ? (
        <div className="rounded-surface border border-border bg-surface p-6 shadow-soft" aria-busy="true">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-5 h-9 w-full max-w-xl" rounded="control" />
        </div>
      ) : account.isError ? (
        <Notice
          tone="error"
          title="The Google Sheet settings could not be loaded"
          action={
            <Button variant="outline" size="sm" onClick={() => void account.refetch()}>
              Try again
            </Button>
          }
        >
          {userMessage(account.error)}
        </Notice>
      ) : (
        <div className="flex flex-col gap-6">
          {!configured && (
            <Notice
              tone="warning"
              title="Google Sheet import is off on this server"
              action={
                <Button variant="outline" size="sm" onClick={() => void account.refetch()} loading={account.isFetching}>
                  Check again
                </Button>
              }
            >
              <p>{account.data.problem}</p>
              <ol className="mt-2 list-decimal pl-5">
                <li>In Google Cloud, create a service account and a JSON key for it.</li>
                <li>Turn on the Google Sheets API for that project.</li>
                <li>
                  Save the key as <span className="font-mono break-all">{account.data.keyFile}</span>, or set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in
                  .env and restart the API.
                </li>
              </ol>
            </Notice>
          )}
          <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
            {configured && account.data.clientEmail && (
              <>
                <h3 className="text-base font-semibold text-foreground">Share the sheet with TailorIT</h3>
                <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
                  TailorIT reads Google Sheets as this service account. In the sheet, click Share, add the address below as a Viewer, then paste
                  the sheet&apos;s link here. TailorIT only reads the sheet: it never changes it, and it imports it once (import it again to pick
                  up changes).
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code
                    data-testid="sheet-client-email"
                    className="rounded-control border border-border bg-surface-low px-2.5 py-1.5 font-mono text-[13px] break-all text-foreground select-all"
                  >
                    {account.data.clientEmail}
                  </code>
                  <Button variant="outline" size="sm" icon={<CopyIcon size={14} />} onClick={() => void copyEmail(account.data.clientEmail!)}>
                    Copy
                  </Button>
                </div>
              </>
            )}
            <form onSubmit={submit} className={configured ? 'mt-5 flex flex-wrap items-start gap-3' : 'flex flex-wrap items-start gap-3'}>
              <Field
                label="Sheet link"
                hint="Copy it from the address bar. A link that ends in #gid=... opens that tab."
                error={linkError}
                className="min-w-72 flex-1"
              >
                <Input
                  value={link}
                  onChange={(event) => editLink(event.target.value)}
                  onBlur={() => setLinkTouched(true)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!configured}
                />
              </Field>
              <Button type="submit" className="sm:mt-[26px]" loading={readingSheet} disabled={!configured || !ref.ok}>
                Read sheet
              </Button>
            </form>
            {configured && otherError ? (
              <Notice tone="error" className="mt-5">
                {userMessage(otherError)}
              </Notice>
            ) : null}
          </div>
        </div>
      )}

      {preview && mapping && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 truncate text-base font-semibold text-foreground">{preview.spreadsheetTitle}</h3>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                <ArrowSquareOutIcon size={14} />
                Open in Google Sheets
              </a>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="Tab" error={tabError}>
                <Select
                  options={preview.tabs.map((tab) => ({ value: String(tab.gid), label: tab.hidden ? `${tab.title} (hidden)` : tab.title }))}
                  value={String(chosenGid ?? preview.tab.gid)}
                  onValueChange={(value) => chooseTab(Number(value))}
                />
              </Field>
              <Field label="Header row" hint="The row with the column names. Rows above it are skipped." error={headerRowError}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={SHEET_MAX_HEADER_ROW}
                  value={headerText}
                  onChange={(event) => setHeaderText(event.target.value)}
                  onBlur={() => applyHeaderRow()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyHeaderRow();
                    }
                  }}
                />
              </Field>
            </div>
            {preview.suggestedHeaderRow !== null && (
              <Notice
                tone="info"
                className="mt-4"
                action={
                  <Button variant="outline" size="sm" onClick={() => applyHeaderRow(String(preview.suggestedHeaderRow))}>
                    Use row {preview.suggestedHeaderRow}
                  </Button>
                }
              >
                Row {preview.suggestedHeaderRow} looks like the header row.
              </Notice>
            )}
            {preview.tabDate && (
              <div className="mt-4 flex flex-col gap-1">
                <Checkbox
                  checked={usesTabDate}
                  onCheckedChange={(checked) => toggleTabDate(checked)}
                  label={`Use the tab name (${preview.tab.title}) as every job's posted date`}
                />
                <p className="pl-7 text-[13px] leading-5 text-muted-foreground">For free_tailor sheets, where each day has its own tab.</p>
              </div>
            )}
            {preview.notes.length > 0 && (
              <Notice tone="info" className="mt-4" title="About this tab">
                <ul className="list-disc pl-5">
                  {preview.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {existing &&
              (existing.sameSheet ? (
                <Notice tone="info" className="mt-4">
                  You imported this tab before as &quot;{existing.name}&quot;. Importing it again replaces that copy: new and changed rows are
                  updated, and jobs you removed from the sheet stay open.
                </Notice>
              ) : (
                <Notice tone="warning" className="mt-4">
                  A source named &quot;{existing.name}&quot; holds another import. Enter a different source name below.
                </Notice>
              ))}
          </div>

          <ImportColumns
            preview={preview}
            mapping={mapping}
            onRemap={changeMapping}
            countLabel="Google Sheet"
            sampleLabel="First rows of the sheet"
            noneLabel="Not in this tab"
            disabledFields={usesTabDate ? { postedAt: 'From the tab name' } : undefined}
            name={name}
            onNameChange={setName}
            onNameBlur={checkName}
            namePlaceholder={preview.sourceName}
            nameHint={`Defaults to ${preview.sourceName}.`}
            importing={save.isPending}
            importDisabled={reading || nameTaken || !configured}
            onImport={startImport}
          />
        </div>
      )}

      <ImportResultNotice result={result} error={save.error} noun="tab" onShowRuns={onShowRuns} />
    </div>
  );
}
