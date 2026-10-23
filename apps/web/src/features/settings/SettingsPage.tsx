'use client';

import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABEL,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABEL,
} from '@tailorit/shared/jobs';
import type { Account, Preferences } from '@tailorit/shared/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Field, FieldLabel } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { useToast } from '@/components/ui/Toast';
import { ApiError, userMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatSalary } from '@/lib/format';
import { PREFERENCES_QUERY_KEY, fetchPreferences, renameAccount, savePreferences } from './api';

const SALARY_MAX = 400_000;
const SALARY_STEP = 5_000;
/** The Jobs page's match (work package J2), which carries the experience-level check against these preferences. */
const JOBS_MATCH_KEY = ['jobs', 'match'] as const;

/** Settings: the display name, the contact details cover letters use, and job preferences. */
export function SettingsPage() {
  const { account } = useAuth();
  const preferences = useQuery({ queryKey: PREFERENCES_QUERY_KEY, queryFn: ({ signal }) => fetchPreferences(signal) });

  return (
    <div className={clsx('mx-auto w-full max-w-[880px] pt-9 pb-20', PAGE_GUTTER)}>
      <h1 className="text-[30px] leading-10 font-bold tracking-[-0.01em] text-foreground">Settings</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Your profile, the contact details your cover letters use, and the jobs you are looking for.
      </p>
      {preferences.isError ? (
        <Notice
          tone="error"
          className="mt-8"
          title="Your settings could not be loaded"
          action={
            <Button variant="outline" size="sm" onClick={() => void preferences.refetch()}>
              Try again
            </Button>
          }
        >
          {userMessage(preferences.error, 'Please try again in a moment.')}
        </Notice>
      ) : preferences.isPending || !account ? (
        <SettingsSkeleton />
      ) : (
        <SettingsForm key={preferences.dataUpdatedAt} account={account} initial={preferences.data} />
      )}
    </div>
  );
}

type FieldErrors = Partial<Record<'name' | 'phone' | 'linkedinUrl' | 'location' | 'portfolioUrl' | 'minSalary', string>>;

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.includes('.');
  } catch {
    return false;
  }
}

function validate(name: string, prefs: Preferences): FieldErrors {
  const errors: FieldErrors = {};
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) errors.name = 'A display name is between 1 and 120 characters.';
  if (prefs.linkedinUrl.trim() && !looksLikeUrl(prefs.linkedinUrl.trim())) errors.linkedinUrl = 'Must be a valid url';
  if (prefs.portfolioUrl.trim() && !looksLikeUrl(prefs.portfolioUrl.trim())) errors.portfolioUrl = 'Must be a valid url';
  return errors;
}

function toggle<V extends string>(list: readonly V[], value: V): V[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function SettingsForm({ account, initial }: { account: Account; initial: Preferences }) {
  const queryClient = useQueryClient();
  const { setAccount } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const nameChanged = name.trim() !== account.name.trim();
  const prefsChanged = JSON.stringify(prefs) !== JSON.stringify(initial);
  const dirty = nameChanged || prefsChanged;

  const save = useMutation({
    mutationFn: async () => {
      if (nameChanged) {
        const updated = await renameAccount(name.trim());
        setAccount(updated ?? { ...account, name: name.trim() });
      }
      if (prefsChanged) {
        const cleaned: Preferences = {
          ...prefs,
          phone: prefs.phone.trim(),
          location: prefs.location.trim(),
          linkedinUrl: prefs.linkedinUrl.trim(),
          portfolioUrl: prefs.portfolioUrl.trim(),
        };
        const saved = await savePreferences(cleaned);
        queryClient.setQueryData(PREFERENCES_QUERY_KEY, saved);
        // The Jobs page reads its level check again instead of comparing against the previous preferences.
        void queryClient.invalidateQueries({ queryKey: JOBS_MATCH_KEY });
      }
    },
    onSuccess: () => {
      toast.success('Settings saved');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fields) {
        setErrors((current) => ({ ...current, ...(error.fields as FieldErrors) }));
      }
      setFormError(userMessage(error, 'Your settings could not be saved. Please try again.'));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const found = validate(name, prefs);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate();
  };

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-6">
      <Section title="Profile" description="How TailorIT addresses you.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Display name" error={errors.name}>
            <Input
              value={name}
              maxLength={120}
              autoComplete="name"
              onChange={(event) => {
                setName(event.target.value);
                if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
              }}
            />
          </Field>
          <Field label="Email" hint="You sign in with this address.">
            <Input value={account.email} readOnly disabled />
          </Field>
        </div>
      </Section>

      <Section
        title="Contact details"
        description="Cover letters use these when your resume does not include them."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Phone" optional error={errors.phone}>
            <Input
              type="tel"
              autoComplete="tel"
              placeholder="(555) 123-4567"
              value={prefs.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
          <Field label="Location" optional error={errors.location}>
            <Input
              autoComplete="address-level2"
              placeholder="City, State"
              value={prefs.location}
              onChange={(event) => set('location', event.target.value)}
            />
          </Field>
          <Field label="LinkedIn URL" optional error={errors.linkedinUrl}>
            <Input
              type="url"
              inputMode="url"
              placeholder="linkedin.com/in/your-name"
              value={prefs.linkedinUrl}
              onChange={(event) => set('linkedinUrl', event.target.value)}
            />
          </Field>
          <Field label="Portfolio URL" optional error={errors.portfolioUrl}>
            <Input
              type="url"
              inputMode="url"
              placeholder="your-site.com"
              value={prefs.portfolioUrl}
              onChange={(event) => set('portfolioUrl', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Job preferences" description="Jobs uses these to point out roles that fit what you are looking for.">
        <div className="flex flex-col gap-6">
          <ChoiceGroup
            label="Experience level"
            options={EXPERIENCE_LEVELS.map((value) => ({ value, label: EXPERIENCE_LEVEL_LABEL[value] }))}
            selected={prefs.experienceLevels}
            onToggle={(value) => set('experienceLevels', toggle(prefs.experienceLevels, value))}
          />
          <ChoiceGroup
            label="Job type"
            options={EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABEL[value] }))}
            selected={prefs.jobTypes}
            onToggle={(value) => set('jobTypes', toggle(prefs.jobTypes, value))}
          />
          <ChoiceGroup
            label="Work arrangement"
            options={WORK_ARRANGEMENTS.map((value) => ({ value, label: WORK_ARRANGEMENT_LABEL[value] }))}
            selected={prefs.workArrangements}
            onToggle={(value) => set('workArrangements', toggle(prefs.workArrangements, value))}
          />
          <div className="flex max-w-md flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <FieldLabel>Minimum salary</FieldLabel>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {prefs.minSalary ? `${formatSalary(prefs.minSalary)}/yr` : 'No minimum'}
              </span>
            </div>
            <Slider
              value={prefs.minSalary ?? 0}
              min={0}
              max={SALARY_MAX}
              step={SALARY_STEP}
              thumbLabels={['Minimum salary']}
              formatValue={(value) => (value ? `${formatSalary(value)} a year` : 'No minimum')}
              onValueChange={(value) => set('minSalary', value > 0 ? value : null)}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>$0</span>
              <span>$400k+</span>
            </div>
          </div>
        </div>
      </Section>

      {formError && <Notice tone="error">{formError}</Notice>}

      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setName(account.name);
            setPrefs(initial);
            setErrors({});
            setFormError(null);
          }}
        >
          Discard changes
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!dirty}>
          {save.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-surface border border-border bg-surface p-6 shadow-soft" aria-label={title}>
      <h2 className="text-base leading-6 font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ChoiceGroup<V extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: V; label: string }[];
  selected: readonly V[];
  onToggle: (value: V) => void;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2.5">
      <span id={labelId} className="text-sm leading-5 font-medium text-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <Chip
              key={option.value}
              selected={on}
              onClick={() => onToggle(option.value)}
              icon={on ? <CheckIcon size={14} weight="bold" /> : undefined}
            >
              {option.label}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="mt-8 flex flex-col gap-6" aria-busy="true" aria-label="Loading settings">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-surface border border-border bg-surface p-6 shadow-soft">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" rounded="control" />
            <Skeleton className="h-9 w-full" rounded="control" />
          </div>
        </div>
      ))}
    </div>
  );
}
