'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { ArrowsClockwiseIcon, SparkleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { userMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { adminKeys, fetchAiHealth, runAiTest } from './api';
import { SectionHeader } from './parts';
import type { AiHealth } from './types';

const KIND_LABEL: Record<string, string> = {
  resume_import: 'Resume import',
  entry_bullets: 'Resume bullets',
  job_analysis: 'Job analysis',
  cover_letter: 'Cover letters',
  template_fill: 'Template fill',
};

/** Admin > AI: the local Claude CLI's health (version, sign-in, models) and a one-prompt connectivity test. */
export function AiTab() {
  const queryClient = useQueryClient();
  const now = useNow();
  const health = useQuery({ queryKey: adminKeys.aiHealth, queryFn: ({ signal }) => fetchAiHealth(false, signal) });
  const recheck = useMutation({
    mutationFn: () => fetchAiHealth(true),
    onSuccess: (answer) => queryClient.setQueryData(adminKeys.aiHealth, answer),
  });
  const test = useMutation({ mutationFn: runAiTest });

  const data: AiHealth | undefined = recheck.data ?? health.data;

  return (
    <section>
      <SectionHeader
        title="AI"
        description="AI features run through the Claude CLI signed in on this server, on its subscription. Job analysis uses it lazily, the first time a job is opened."
        actions={
          <>
            <Button variant="outline" icon={<ArrowsClockwiseIcon size={16} />} onClick={() => recheck.mutate()} loading={recheck.isPending}>
              Check again
            </Button>
            <Button icon={<SparkleIcon size={16} />} onClick={() => test.mutate()} loading={test.isPending} disabled={!data?.enabled}>
              Run test
            </Button>
          </>
        }
      />

      {health.isError ? (
        <Notice tone="error" title="AI health could not be read">
          {userMessage(health.error)}
        </Notice>
      ) : !data ? (
        <div className="rounded-surface border border-border bg-surface p-6 shadow-soft">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="mt-4 h-4 w-3/4" />
        </div>
      ) : (
        <div className="rounded-surface border border-border bg-surface p-6 shadow-soft" data-ai-health={data.available ? 'available' : 'unavailable'}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={clsx('size-2.5 shrink-0 rounded-full', data.available ? 'bg-success' : data.enabled ? 'bg-warning' : 'bg-control-strong')}
            />
            <h3 className="text-base font-semibold text-foreground">
              {data.available ? 'Claude CLI is ready' : data.enabled ? 'Claude CLI is not available' : 'AI is turned off'}
            </h3>
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{data.message}</p>
          <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="CLI version" value={data.cliVersion ?? 'Not found'} />
            <Fact label="Signed in" value={data.loggedIn ? [data.authMethod, data.subscriptionType].filter(Boolean).join(', ') || 'Yes' : 'No'} />
            <Fact label="Default model" value={data.defaultModel} />
            <Fact label="Checked" value={relativeTime(data.checkedAt, now)} />
          </dl>
          <h4 className="mt-6 text-sm font-semibold text-foreground">Models by feature</h4>
          <ul className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            {Object.entries(data.models).map(([kind, model]) => (
              <li key={kind} className="flex justify-between gap-4 border-b border-divider-soft py-1.5">
                <span className="text-muted-foreground">{KIND_LABEL[kind] ?? kind}</span>
                <span className="font-mono text-xs leading-5 text-foreground">{model}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {test.isError && (
        <Notice tone="error" className="mt-5">
          {userMessage(test.error)}
        </Notice>
      )}
      {test.data && (
        <Notice tone={test.data.ok ? 'success' : 'error'} className="mt-5" title={test.data.ok ? 'The test prompt worked' : 'The test prompt failed'}>
          {test.data.ok
            ? `${test.data.model} answered "${test.data.answer ?? ''}" in ${(test.data.ms / 1000).toFixed(1)} s.`
            : `${test.data.error?.message ?? 'No answer.'}${test.data.error?.detail ? ` (${test.data.error.detail})` : ''}`}
        </Notice>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}
