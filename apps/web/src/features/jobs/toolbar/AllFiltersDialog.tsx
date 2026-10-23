'use client';

import {
  CLEARANCE_FILTERS,
  CLEARANCE_FILTER_LABEL,
  COMPANY_SIZES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABEL,
  LEADERSHIP,
  LEADERSHIP_LABEL,
  UPDATED_WITHIN_DAYS,
  UPDATED_WITHIN_LABEL,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABEL,
  jobFilterCounts,
  type JobsQuery,
  type SalaryPeriod,
} from '@tailorit/shared';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { CountBadge } from '@/components/ui/Badge';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { MagnifyingGlassIcon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { clearedQuery, minSalaryLabel, toggled } from '../filters';
import { useFacet, useFacetsSummary, useJobsCount } from '../hooks';
import { FunnelSimpleIcon } from '../icons';
import { CategoryPicker } from './CategoryFilter';
import { LocationFields } from './LocationFilter';
import { useDebouncedValue } from './useDebouncedValue';

/** The pay periods the Minimum salary slider offers, with each one's range (Simplify: $0–$400k a year). */
const PAY_PERIODS: Array<{ value: SalaryPeriod; label: string; max: number; step: number }> = [
  { value: 'year', label: 'Yearly', max: 400_000, step: 10_000 },
  { value: 'month', label: 'Monthly', max: 35_000, step: 500 },
  { value: 'week', label: 'Weekly', max: 8_000, step: 100 },
  { value: 'hour', label: 'Hourly', max: 200, step: 5 },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-border py-6 first:border-t-0 first:pt-2">
      <h3 className="text-base leading-6 font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <p className="text-sm leading-5 font-medium text-foreground">{label}</p>
        {hint && <p className="text-[13px] leading-5 text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ChipChoices<V extends string>({
  values,
  labels,
  chosen,
  onChange,
}: {
  values: readonly V[];
  labels: (value: V) => string;
  chosen: readonly V[];
  onChange: (next: V[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => {
        const on = chosen.includes(value);
        return (
          <Chip key={value} size="sm" selected={on} onClick={() => onChange(toggled(chosen, value, !on))}>
            {labels(value)}
          </Chip>
        );
      })}
    </div>
  );
}

function CompanyPicker({ chosen, onChange }: { chosen: readonly string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState('');
  const search = useDebouncedValue(text.trim(), 200);
  const companies = useFacet('companies', search);
  const items = companies.data?.items ?? [];
  return (
    <div className="rounded-control border border-border">
      <div className="p-2">
        <Input
          aria-label="Search companies"
          placeholder="Search companies"
          size="sm"
          leading={<MagnifyingGlassIcon size={14} />}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <ul className="max-h-[180px] overflow-y-auto border-t border-border p-1.5" aria-label="Companies">
        {items.length === 0 ? (
          <li className="px-1.5 py-1.5 text-sm text-muted-foreground">{companies.isPending ? 'Loading...' : 'No companies match.'}</li>
        ) : (
          items.map((item) => (
            <li key={item.value} className="flex min-h-8 items-center gap-2 rounded-menu-row px-1.5 hover:bg-hover">
              <Checkbox
                label={<span className="truncate">{item.label}</span>}
                checked={chosen.includes(item.value)}
                onCheckedChange={(on) => onChange(toggled(chosen, item.value, on))}
                className="min-w-0 flex-1 py-1.5"
              />
              <span className="text-xs text-muted-foreground tabular-nums">{item.count.toLocaleString('en-US')}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * Simplify's "All filters": every filter of the page, grouped (Role, Location, Compensation, Company, Your profile,
 * Preferences). Changes are a draft until "Show N jobs" applies them; a filter only appears when the data has
 * values for it.
 */
export function AllFiltersDialog({ query, onApply }: { query: JobsQuery; onApply: (query: JobsQuery) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JobsQuery>(query);
  const summary = useFacetsSummary();
  const settledDraft = useDebouncedValue(draft, 250);
  const count = useJobsCount(settledDraft, open);
  const industries = useFacet('industries', '', open && Boolean(summary.data?.available.industries));
  const available = summary.data?.available;

  const counts = jobFilterCounts(query);
  const otherCount = counts.total - counts.location - counts.jobType - counts.experience - counts.category;
  const change = (patch: Partial<JobsQuery>) => setDraft((previous) => ({ ...previous, ...patch, cursor: undefined }));
  const period = PAY_PERIODS.find((entry) => entry.value === (draft.payPeriod ?? 'year')) ?? PAY_PERIODS[0]!;
  const total = count.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(query);
        setOpen(next);
      }}
    >
      <span className="relative inline-flex">
        <IconButton
          label="All filters"
          variant="outline"
          shape="round"
          icon={<FunnelSimpleIcon size={18} />}
          onClick={() => {
            setDraft(query);
            setOpen(true);
          }}
        />
        {otherCount > 0 && <CountBadge count={otherCount} className="pointer-events-none absolute -top-1.5 -right-1.5" />}
      </span>
      <DialogContent title="All filters" size="xl">
        <div className="-mx-6 mt-2 min-h-0 flex-1 overflow-y-auto px-6">
          <Group title="Last updated">
            <div className="flex flex-wrap gap-2">
              <Chip size="sm" selected={!draft.updatedWithin} onClick={() => change({ updatedWithin: undefined })}>
                Any time
              </Chip>
              {UPDATED_WITHIN_DAYS.map((days) => (
                <Chip key={days} size="sm" selected={draft.updatedWithin === days} onClick={() => change({ updatedWithin: days })}>
                  {UPDATED_WITHIN_LABEL[days]}
                </Chip>
              ))}
            </div>
          </Group>

          <Group title="Role">
            <Row label="Job type">
              <ChipChoices
                values={EMPLOYMENT_TYPES}
                labels={(value) => EMPLOYMENT_TYPE_LABEL[value]}
                chosen={draft.jobTypes}
                onChange={(jobTypes) => change({ jobTypes })}
              />
            </Row>
            <Row label="Experience level">
              <ChipChoices
                values={EXPERIENCE_LEVELS}
                labels={(value) => EXPERIENCE_LEVEL_LABEL[value]}
                chosen={draft.levels}
                onChange={(levels) => change({ levels })}
              />
            </Row>
            <Row label="Category">
              <CategoryPicker query={draft} onChange={change} className="rounded-control border border-border" />
            </Row>
            {available?.leadership && (
              <Row label="Leadership">
                <ChipChoices
                  values={LEADERSHIP}
                  labels={(value) => LEADERSHIP_LABEL[value]}
                  chosen={draft.leadership}
                  onChange={(leadership) => change({ leadership })}
                />
              </Row>
            )}
          </Group>

          <Group title="Location">
            <Row label="Work arrangement">
              <ChipChoices
                values={WORK_ARRANGEMENTS}
                labels={(value) => WORK_ARRANGEMENT_LABEL[value]}
                chosen={draft.arrangements}
                onChange={(arrangements) => change({ arrangements })}
              />
            </Row>
            <Row label="Location">
              <div className="rounded-control border border-border">
                <LocationFields query={draft} onChange={change} withArrangements={false} />
              </div>
            </Row>
          </Group>

          {available?.salary && (
            <Group title="Compensation">
              <Row label="Minimum salary" hint="Postings that pay at least this much (in US dollars).">
                <div className="flex items-center gap-4">
                  <Slider
                    min={0}
                    max={period.max}
                    step={period.step}
                    value={Math.min(draft.minSalary ?? 0, period.max)}
                    onValueChange={(value) => change({ minSalary: value > 0 ? value : undefined })}
                    thumbLabels={['Minimum salary']}
                    formatValue={(value) => (value > 0 ? minSalaryLabel(value, period.value) : 'Any salary')}
                    className="flex-1"
                  />
                  <span className="w-28 text-right text-sm font-semibold text-foreground tabular-nums">
                    {draft.minSalary ? minSalaryLabel(draft.minSalary, period.value) : 'Any'}
                  </span>
                  <Select
                    aria-label="Pay period"
                    options={PAY_PERIODS.map((entry) => ({ value: entry.value, label: entry.label }))}
                    value={period.value}
                    onValueChange={(value) => change({ payPeriod: value === 'year' ? undefined : value, minSalary: undefined })}
                    className="w-32"
                  />
                </div>
              </Row>
            </Group>
          )}

          <Group title="Company">
            {available?.h1b && (
              <Switch
                label="Only companies that sponsor H1B visas"
                checked={Boolean(draft.h1b)}
                onCheckedChange={(on) => change({ h1b: on || undefined })}
              />
            )}
            {available?.industries && (
              <Row label="Industry">
                <ChipChoices
                  values={(industries.data?.items ?? []).map((item) => item.value as JobsQuery['industries'][number])}
                  labels={(value) => industries.data?.items.find((item) => item.value === value)?.label ?? value}
                  chosen={draft.industries}
                  onChange={(next) => change({ industries: next })}
                />
              </Row>
            )}
            {available?.companySizes && (
              <Row label="Company size">
                <ChipChoices
                  values={COMPANY_SIZES.map((size) => size.id)}
                  labels={(value) => COMPANY_SIZES.find((size) => size.id === value)?.label ?? value}
                  chosen={draft.companySizes}
                  onChange={(companySizes) => change({ companySizes })}
                />
              </Row>
            )}
            <Row label="Company">
              <CompanyPicker chosen={draft.companies} onChange={(companies) => change({ companies })} />
            </Row>
          </Group>

          {available?.clearance && (
            <Group title="Your profile">
              <Row label="Security clearance">
                <div className="flex flex-wrap gap-2">
                  <Chip size="sm" selected={!draft.clearance} onClick={() => change({ clearance: undefined })}>
                    Any
                  </Chip>
                  {CLEARANCE_FILTERS.map((value) => (
                    <Chip key={value} size="sm" selected={draft.clearance === value} onClick={() => change({ clearance: value })}>
                      {CLEARANCE_FILTER_LABEL[value]}
                    </Chip>
                  ))}
                </div>
              </Row>
            </Group>
          )}

          <Group title="Preferences">
            <Switch
              label="Hide jobs I've applied to"
              checked={Boolean(draft.hideApplied)}
              onCheckedChange={(on) => change({ hideApplied: on || undefined })}
            />
          </Group>
        </div>

        <div className="-mx-6 flex items-center gap-3 border-t border-border px-6 pt-4">
          <Button variant="ghost" onClick={() => setDraft(clearedQuery(draft))}>
            Clear all
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              {total === undefined ? 'Show jobs' : `Show ${total.toLocaleString('en-US')} ${total === 1 ? 'job' : 'jobs'}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
