'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { ArrowsClockwiseIcon, BriefcaseIcon, DotsThreeIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { userMessage } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { adminKeys, createSource, deleteSource, fetchSources, runSource, testLake, testSource, updateSource } from './api';
import { AdminTable, RunStatusBadge, runCounts, SectionHeader, TableSkeleton, type AdminColumn } from './parts';
import type { AddableKind, AdminSource, NewSourceBody } from './types';

/** What a source reads, in a few words: "Board gitlab", "Site palantir (EU)", "sheet.csv". */
export function sourceDetail(source: Pick<AdminSource, 'kind' | 'config'>): string {
  const text = (key: string) => (typeof source.config[key] === 'string' ? (source.config[key] as string) : '');
  switch (source.kind) {
    case 'greenhouse':
      return `Board ${text('token')}`;
    case 'lever':
      return `Site ${text('site')}${text('region') === 'eu' ? ' (EU)' : ''}`;
    case 'ashby':
      return `Board ${text('board')}`;
    case 'ft_lake':
      return text('path') || 'Default database path';
    case 'csv':
    case 'json':
      return text('fileName') || 'Uploaded file';
    case 'seed':
      return text('anchor') ? `Dated from ${formatDate(text('anchor'))}` : 'Demo postings';
  }
}

/** Admin > Sources: every job source, its last run, and the controls to run, pause, add and delete them. */
export function SourcesTab({ onShowRuns }: { onShowRuns: (sourceId: number) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AdminSource | null>(null);

  const sources = useQuery({
    queryKey: adminKeys.sources,
    queryFn: ({ signal }) => fetchSources(signal),
    // While a run is going, follow it.
    refetchInterval: (query) => (query.state.data?.items.some((source) => source.running) ? 2000 : false),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.sources });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'runs'] });
  };

  const run = useMutation({
    mutationFn: (source: AdminSource) => runSource(source.id),
    onSuccess: (_answer, source) => {
      toast.success(`Running ${source.name}`, 'The run continues in the background. Its result appears under Runs.');
      refresh();
    },
    onError: (error) => toast.error('The run did not start', userMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (source: AdminSource) => updateSource(source.id, { enabled: !source.enabled }),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminKeys.sources, (previous: { items: AdminSource[] } | undefined) =>
        previous ? { ...previous, items: previous.items.map((item) => (item.id === updated.id ? updated : item)) } : previous,
      );
    },
    onError: (error) => toast.error('The source was not changed', userMessage(error)),
  });

  const columns: AdminColumn<AdminSource>[] = [
    {
      key: 'source',
      header: 'Source',
      cell: (source) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{source.name}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {source.kindLabel} · {sourceDetail(source)}
          </p>
        </div>
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      className: 'w-28',
      cell: (source) => (
        <Switch
          checked={source.enabled}
          onCheckedChange={() => toggle.mutate(source)}
          disabled={toggle.isPending}
          aria-label={`${source.enabled ? 'Pause' : 'Enable'} ${source.name}`}
        />
      ),
    },
    {
      key: 'last',
      header: 'Last run',
      className: 'w-44',
      cell: (source) =>
        source.lastRunAt ? (
          <Tooltip content={new Date(source.lastRunAt).toLocaleString('en-US')}>
            <span className="text-muted-foreground">{relativeTime(source.lastRunAt, now)}</span>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-32',
      cell: (source) => <RunStatusBadge status={source.running ? 'running' : (source.lastRun?.status ?? null)} />,
    },
    {
      key: 'counts',
      header: 'Jobs',
      className: 'w-64',
      cell: (source) => (
        <div>
          <p>
            <span className="font-semibold">{source.activeJobCount}</span>
            <span className="text-muted-foreground"> live of {source.jobCount}</span>
          </p>
          {source.lastRun && <p className="text-[13px] text-muted-foreground">{runCounts(source.lastRun)}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-44 text-right',
      cell: (source) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            icon={<ArrowsClockwiseIcon size={14} />}
            disabled={source.running || (run.isPending && run.variables?.id === source.id)}
            onClick={() => run.mutate(source)}
          >
            {source.running ? 'Running' : 'Run now'}
          </Button>
          <Menu>
            <MenuTrigger render={<IconButton label={`More actions for ${source.name}`} icon={<DotsThreeIcon size={18} weight="bold" />} size="sm" tooltip={false} />} />
            <MenuContent align="end" width="w-48">
              <MenuItem onClick={() => onShowRuns(source.id)}>See runs</MenuItem>
              <MenuItem icon={<TrashIcon />} tone="danger" disabled={source.running} onClick={() => setDeleting(source)}>
                Delete source
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby="admin-sources-title">
      <SectionHeader
        title="Job sources"
        description="Public job boards, free_tailor's Job Data Lake, uploads and the demo set. Daily sources run on the schedule; any source can run now."
        actions={
          <Button icon={<PlusIcon size={16} />} onClick={() => setAdding(true)}>
            Add source
          </Button>
        }
      />
      <span id="admin-sources-title" className="sr-only">
        Job sources
      </span>
      {sources.isError ? (
        <Notice tone="error" title="The sources could not be loaded" action={<Button variant="outline" size="sm" onClick={() => void sources.refetch()}>Try again</Button>}>
          {userMessage(sources.error)}
        </Notice>
      ) : sources.isPending ? (
        <TableSkeleton />
      ) : sources.data.items.length === 0 ? (
        <div className="rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<BriefcaseIcon size={22} />}
            title="No job sources yet"
            description="Add a Greenhouse, Lever or Ashby board, the free_tailor lake or the demo jobs, or import a spreadsheet."
            action={<Button onClick={() => setAdding(true)}>Add source</Button>}
          />
        </div>
      ) : (
        <AdminTable aria-label="Job sources" items={sources.data.items} columns={columns} getKey={(source) => source.id} />
      )}

      <AddSourceDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(source) => {
          toast.success('Source added', `${source.name} is ready. Run it now to fetch its jobs.`);
          refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete source"
        description={
          deleting
            ? `Delete ${deleting.name}? Jobs only this source lists are closed, and its run history is deleted. You won't be able to undo this action.`
            : undefined
        }
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          if (!deleting) return;
          await deleteSource(deleting.id);
          toast.success('Source deleted');
          setDeleting(null);
          refresh();
        }}
      />
    </section>
  );
}

const KIND_ITEMS: ReadonlyArray<{ value: AddableKind; label: string }> = [
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'ft_lake', label: 'free_tailor lake' },
  { value: 'seed', label: 'Demo jobs' },
];

interface Draft {
  token: string;
  site: string;
  region: 'global' | 'eu';
  board: string;
  path: string;
  companyName: string;
  name: string;
}

const EMPTY_DRAFT: Draft = { token: '', site: '', region: 'global', board: '', path: '', companyName: '', name: '' };

function bodyOf(kind: AddableKind, draft: Draft): NewSourceBody {
  const company: Record<string, string> = draft.companyName.trim() ? { companyName: draft.companyName.trim() } : {};
  const name = draft.name.trim() || undefined;
  switch (kind) {
    case 'greenhouse':
      return { kind, name, config: { token: draft.token.trim(), ...company } };
    case 'lever':
      return { kind, name, config: { site: draft.site.trim(), region: draft.region, ...company } };
    case 'ashby':
      return { kind, name, config: { board: draft.board.trim(), ...company } };
    case 'ft_lake':
      return { kind, name, config: draft.path.trim() ? { path: draft.path.trim() } : {} };
    case 'seed':
      return { kind, name, config: {} };
  }
}

interface TestOutcome {
  ok: boolean;
  message: string;
  samples: string[];
}

/** "Add source": pick the kind, fill in the board (or the lake path), test it without saving, then add it. */
function AddSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: AdminSource) => void;
}) {
  const [kind, setKind] = useState<AddableKind>('greenhouse');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    setDraft((previous) => ({ ...previous, [key]: event.target.value }));
    setOutcome(null);
  };

  const reset = () => {
    setKind('greenhouse');
    setDraft(EMPTY_DRAFT);
    setOutcome(null);
    setError(null);
  };

  const test = useMutation({
    mutationFn: async (): Promise<TestOutcome> => {
      if (kind === 'ft_lake') {
        const answer = await testLake(draft.path);
        return { ok: answer.ok, message: answer.message, samples: [] };
      }
      if (kind === 'seed') return { ok: true, message: 'The demo set needs no test.', samples: [] };
      const body = bodyOf(kind, draft);
      const answer = await testSource({ kind, config: body.config });
      return { ok: answer.ok, message: answer.message, samples: answer.samples };
    },
    onSuccess: (answer) => {
      setOutcome(answer);
      setError(null);
    },
    onError: (failure) => setError(userMessage(failure)),
  });

  const create = useMutation({
    mutationFn: () => createSource(bodyOf(kind, draft)),
    onSuccess: (source) => {
      onCreated(source);
      reset();
      onOpenChange(false);
    },
    onError: (failure) => setError(userMessage(failure)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  const canTest = kind !== 'seed';
  const missing =
    (kind === 'greenhouse' && !draft.token.trim()) || (kind === 'lever' && !draft.site.trim()) || (kind === 'ashby' && !draft.board.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent title="Add source" description="Where TailorIT should read jobs from." size="lg">
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <SegmentedControl
            aria-label="Source kind"
            size="sm"
            items={KIND_ITEMS}
            value={kind}
            onValueChange={(next) => {
              setKind(next);
              setOutcome(null);
              setError(null);
            }}
            className="max-w-full overflow-x-auto"
          />
          {kind === 'greenhouse' && (
            <Field label="Board token" hint="The name in boards.greenhouse.io/<token>, or the board's address.">
              <Input value={draft.token} onChange={set('token')} placeholder="gitlab" autoComplete="off" />
            </Field>
          )}
          {kind === 'lever' && (
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <Field label="Site name" hint="The name in jobs.lever.co/<site>.">
                <Input value={draft.site} onChange={set('site')} placeholder="palantir" autoComplete="off" />
              </Field>
              <Field label="Region">
                <Select
                  options={[
                    { value: 'global', label: 'Global' },
                    { value: 'eu', label: 'EU' },
                  ]}
                  value={draft.region}
                  onValueChange={(region) => setDraft((previous) => ({ ...previous, region }))}
                />
              </Field>
            </div>
          )}
          {kind === 'ashby' && (
            <Field label="Job board name" hint="The name in jobs.ashbyhq.com/<name>.">
              <Input value={draft.board} onChange={set('board')} placeholder="linear" autoComplete="off" />
            </Field>
          )}
          {kind === 'ft_lake' && (
            <Field
              label="Database path"
              optional
              hint="free_tailor.db, opened read-only. Leave it empty to use FT_LAKE_DB_PATH (by default the free_tailor folder in your local app data)."
            >
              <Input value={draft.path} onChange={set('path')} placeholder="C:\Users\you\AppData\Local\free_tailor\db\free_tailor.db" autoComplete="off" />
            </Field>
          )}
          {kind === 'seed' && (
            <Notice tone="info">About 120 fictional postings from 15 made-up companies, for trying TailorIT out. They are dated from today.</Notice>
          )}
          {(kind === 'greenhouse' || kind === 'lever' || kind === 'ashby') && (
            <Field label="Company name" optional hint="Shown on the jobs when the board does not name the company.">
              <Input value={draft.companyName} onChange={set('companyName')} autoComplete="off" />
            </Field>
          )}
          <Field label="Display name" optional hint="How this source is listed here. Defaults to the board name.">
            <Input value={draft.name} onChange={set('name')} autoComplete="off" />
          </Field>

          {outcome && (
            <Notice tone={outcome.ok ? 'success' : 'error'} title={outcome.ok ? 'It works' : 'That did not work'}>
              <p>{outcome.message}</p>
              {outcome.samples.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {outcome.samples.map((sample) => (
                    <li key={sample}>{sample}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          <DialogFooter flush className="mt-2">
            {canTest && (
              <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={missing}>
                Test
              </Button>
            )}
            <Button type="submit" loading={create.isPending} disabled={missing}>
              Add source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
