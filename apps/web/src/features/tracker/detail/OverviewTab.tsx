'use client';

import { CurrencyDollarIcon } from '@phosphor-icons/react/CurrencyDollar';
import { LinkSimpleIcon } from '@phosphor-icons/react/LinkSimple';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  CURRENCY_SYMBOL,
  EMPLOYMENT_TYPE_LABEL,
  SALARY_ORDER_MESSAGE,
  SALARY_PERIOD_MESSAGE,
  TRACKER_PAY_PERIODS,
  TRACKER_PAY_PERIOD_LABEL,
  URL_MESSAGE,
  formatSalaryRange,
  normalizeUrlInput,
  type ApplicationDetail,
  type EmploymentType,
  type TrackerPayPeriod,
} from '@tailorit/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { ArrowSquareOutIcon, BriefcaseIcon, MapPinIcon, PencilSimpleIcon } from '@/components/ui/icons';
import { isApiError, userMessage } from '@/lib/api';
import { CompanyInput } from '../CompanyInput';
import { invalidateApplications, trackerApi, trackerKeys } from '../data';
import { PROSE, RichTextEditor } from '../RichTextEditor';

const JOB_TYPES: Array<{ value: EmploymentType; label: string }> = [
  { value: 'internship', label: 'Internship' },
  { value: 'full_time', label: 'Full-Time' },
  { value: 'part_time', label: 'Part-Time' },
  { value: 'contract', label: 'Contract' },
];

/** Simplify's currency select reads "USD$"; the usual codes first, then the rest of the symbol table. */
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'INR', ...Object.keys(CURRENCY_SYMBOL)].filter(
  (code, index, all) => all.indexOf(code) === index,
);
const CURRENCY_OPTIONS = CURRENCIES.map((code) => ({ value: code, label: `${code}${CURRENCY_SYMBOL[code] ?? ''}` }));

const PERIOD_OPTIONS = [...TRACKER_PAY_PERIODS]
  .reverse()
  .map((period) => ({ value: period, label: TRACKER_PAY_PERIOD_LABEL[period] }));

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-low text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="min-w-0 text-sm font-medium break-words text-foreground">{children}</span>
      </div>
    </div>
  );
}

function ReadView({ application, onEdit }: { application: ApplicationDetail; onEdit: () => void }) {
  const { salary } = application;
  const range = formatSalaryRange(salary.min, salary.max, salary.currency, null);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Fact icon={<MapPinIcon size={16} />} label="Location">
          {application.location || <span className="font-normal text-muted-foreground">No location</span>}
        </Fact>
        <Fact icon={<CurrencyDollarIcon size={16} />} label="Salary">
          {range ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {range}
              {salary.period && <Badge tone="neutral">{TRACKER_PAY_PERIOD_LABEL[salary.period]}</Badge>}
            </span>
          ) : (
            <span className="font-normal text-muted-foreground">No salary listed</span>
          )}
        </Fact>
        <Fact icon={<BriefcaseIcon size={16} />} label="Job type">
          {EMPLOYMENT_TYPE_LABEL[application.employmentType]}
        </Fact>
        <Fact icon={<LinkSimpleIcon size={16} />} label="Job posting">
          {application.postingUrl ? (
            <a
              href={application.postingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-ink hover:underline"
            >
              View Job Posting
              <ArrowSquareOutIcon size={14} />
            </a>
          ) : (
            <span className="font-normal text-muted-foreground">No link added</span>
          )}
        </Fact>
      </div>
      <section aria-labelledby="description-heading" className="border-t border-border pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="description-heading" className="text-base font-semibold text-foreground">
            Job Description
          </h3>
          <Button variant="ghost" size="sm" icon={<PencilSimpleIcon size={14} />} onClick={onEdit}>
            Edit
          </Button>
        </div>
        {application.descriptionHtml ? (
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: application.descriptionHtml }} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No job description yet. Add one to keep the posting at hand and to see your resume score.
          </p>
        )}
      </section>
    </div>
  );
}

const amountText = (value: number | null) => (value === null ? '' : String(value));

function parseAmount(text: string): number | null | 'invalid' {
  const clean = text.replace(/[\s,$]/g, '');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value : 'invalid';
}

type Errors = Partial<Record<'title' | 'companyName' | 'postingUrl' | 'salaryMin' | 'salaryMax' | 'salaryPeriod', string>>;

/** The pay fields are checked together, so a change to any of them clears all their errors. */
const SALARY_FIELDS: ReadonlyArray<keyof Errors> = ['salaryMin', 'salaryMax', 'salaryPeriod'];

/** "Edit Job Posting": the fields Simplify edits here, saved together. */
function EditForm({ application, onDone }: { application: ApplicationDetail; onDone: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(application.title);
  const [companyName, setCompanyName] = useState(application.companyName);
  const [location, setLocation] = useState(application.location);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(application.employmentType);
  const [currency, setCurrency] = useState(application.salary.currency ?? 'USD');
  const [min, setMin] = useState(amountText(application.salary.min));
  const [max, setMax] = useState(amountText(application.salary.max));
  const [period, setPeriod] = useState<TrackerPayPeriod>(application.salary.period ?? 'year');
  const [url, setUrl] = useState(application.postingUrl.replace(/^https:\/\//i, ''));
  const [description, setDescription] = useState(application.descriptionHtml);
  // Sent only when edited: the editor would normalise markup it does not model (tables, images) on an untouched posting.
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** A field's error goes as soon as the field changes (Save checks again). */
  const clearErrors = (...fields: Array<keyof Errors>) =>
    setErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!title.trim()) next.title = 'Required';
    if (!companyName.trim()) next.companyName = 'Required';
    const salaryMin = parseAmount(min);
    const salaryMax = parseAmount(max);
    if (salaryMin === 'invalid') next.salaryMin = 'Enter a number';
    if (salaryMax === 'invalid') next.salaryMax = 'Enter a number';
    if (typeof salaryMin === 'number' && typeof salaryMax === 'number' && salaryMax < salaryMin) next.salaryMax = SALARY_ORDER_MESSAGE;
    if ((typeof salaryMin === 'number' || typeof salaryMax === 'number') && !period) next.salaryPeriod = SALARY_PERIOD_MESSAGE;
    const postingUrl = normalizeUrlInput(/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url : url.trim() ? `https://${url.trim()}` : '');
    if (postingUrl === null) next.postingUrl = URL_MESSAGE;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      const saved = await trackerApi.patch(application.id, {
        title: title.trim(),
        companyName: companyName.trim(),
        location: location.trim(),
        employmentType,
        postingUrl: postingUrl ?? '',
        ...(descriptionEdited ? { descriptionHtml: description } : {}),
        salaryMin: salaryMin as number | null,
        salaryMax: salaryMax as number | null,
        salaryCurrency: salaryMin === null && salaryMax === null ? null : currency,
        salaryPeriod: salaryMin === null && salaryMax === null ? null : period,
      });
      client.setQueryData(trackerKeys.detail(application.id), saved);
      void invalidateApplications(client);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.fields) setErrors(error.fields as Errors);
      setFailure(userMessage(error, "We couldn't save the job posting. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-labelledby="edit-posting-heading">
      <h3 id="edit-posting-heading" className="text-base font-semibold text-foreground">
        Edit Job Posting
      </h3>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Position Title" required error={errors.title}>
          <Input
            value={title}
            maxLength={200}
            onChange={(event) => {
              setTitle(event.target.value);
              clearErrors('title');
            }}
            placeholder="Title"
          />
        </Field>
        <Field label="Company" required error={errors.companyName}>
          <CompanyInput
            value={companyName}
            onValueChange={(value) => {
              setCompanyName(value);
              clearErrors('companyName');
            }}
          />
        </Field>
        <Field label="Location">
          <Input value={location} maxLength={200} onChange={(event) => setLocation(event.target.value)} placeholder="Location" />
        </Field>
        <Field label="Job Type" required>
          <Select options={JOB_TYPES} value={employmentType} onValueChange={setEmploymentType} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-foreground">Salary</legend>
        <div className="grid gap-3 sm:grid-cols-[7.5rem_1fr_1fr_10rem]">
          <Select aria-label="Currency" options={CURRENCY_OPTIONS} value={currency} onValueChange={setCurrency} />
          <Input
            aria-label="Min. Salary"
            placeholder="Min. Salary"
            inputMode="decimal"
            value={min}
            aria-invalid={errors.salaryMin ? true : undefined}
            onChange={(event) => {
              setMin(event.target.value);
              clearErrors(...SALARY_FIELDS);
            }}
          />
          <Input
            aria-label="Max. Salary"
            placeholder="Max. Salary"
            inputMode="decimal"
            value={max}
            aria-invalid={errors.salaryMax ? true : undefined}
            onChange={(event) => {
              setMax(event.target.value);
              clearErrors(...SALARY_FIELDS);
            }}
          />
          <Select
            aria-label="Pay Period"
            placeholder="Pay Period"
            options={PERIOD_OPTIONS}
            value={period}
            onValueChange={(value) => {
              setPeriod(value);
              clearErrors(...SALARY_FIELDS);
            }}
          />
        </div>
        {(errors.salaryMin || errors.salaryMax || errors.salaryPeriod) && (
          <p className="text-[13px] leading-5 text-[#c62a29]">{errors.salaryMax ?? errors.salaryMin ?? errors.salaryPeriod}</p>
        )}
      </fieldset>
      <Field label="URL" error={errors.postingUrl}>
        <div className="flex w-full items-stretch">
          <span className="flex items-center rounded-l-control border border-r-0 border-control bg-surface-low px-3 text-sm text-muted-foreground">
            https://
          </span>
          <Input
            value={url}
            placeholder="www.example.com/jobs/123"
            className="rounded-l-none"
            onChange={(event) => {
              setUrl(event.target.value);
              clearErrors('postingUrl');
            }}
          />
        </div>
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Description</span>
        <RichTextEditor
          value={application.descriptionHtml}
          onChange={(html) => {
            setDescription(html);
            setDescriptionEdited(true);
          }}
          placeholder="Add a job description for the posting"
          label="Job description"
          minHeight={220}
        />
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function OverviewTab({
  application,
  editing,
  onEditingChange,
}: {
  application: ApplicationDetail;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  if (editing) return <EditForm application={application} onDone={() => onEditingChange(false)} />;
  return <ReadView application={application} onEdit={() => onEditingChange(true)} />;
}
