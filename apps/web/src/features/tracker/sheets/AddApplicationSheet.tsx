'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { ApplicationDetail, ApplicationStatus, EmploymentType } from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Sheet, SheetContent } from '@/components/ui/Sheet';
import { BriefcaseIcon } from '@/components/ui/icons';
import { api, isApiError, userMessage } from '@/lib/api';
import { CompanyInput } from '../CompanyInput';
import { localToday, trackerApi, useResumeOptions } from '../data';
import { DEFAULT_NEW_STATUS } from '../state';
import { statusOptions } from '../status';

const FORM_ID = 'add-application-form';

export const JOB_TYPE_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: 'internship', label: 'Internship' },
  { value: 'full_time', label: 'Full-Time' },
  { value: 'part_time', label: 'Part-Time' },
];

const NO_RESUME = 'none';

/** Simplify's default job type: Internship for someone who only looks for internships, else Full-Time. */
function usePreferredJobType(): EmploymentType {
  const preferences = useQuery({
    queryKey: ['me', 'preferences'],
    queryFn: ({ signal }) => api.get<{ jobTypes?: unknown }>('/api/me/preferences', { signal }),
    staleTime: 60_000,
    retry: false,
  });
  const types = Array.isArray(preferences.data?.jobTypes) ? (preferences.data.jobTypes as unknown[]) : [];
  return types.includes('internship') && !types.includes('full_time') ? 'internship' : 'full_time';
}

const FIELD_NAMES = ['title', 'companyName', 'location', 'employmentType', 'status', 'resumeId'] as const;
type FieldName = (typeof FIELD_NAMES)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

function AddApplicationForm({
  onSavingChange,
  onAdded,
}: {
  onSavingChange: (saving: boolean) => void;
  onAdded: (application: ApplicationDetail) => void;
}) {
  const resumes = useResumeOptions(true);
  const preferredType = usePreferredJobType();
  const [title, setTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [location, setLocation] = useState('');
  const [chosenType, setChosenType] = useState<EmploymentType | null>(null);
  const [status, setStatus] = useState<ApplicationStatus>(DEFAULT_NEW_STATUS);
  /** The person's pick (a resume id, or NO_RESUME for "None"); null until they touch the select. */
  const [chosenResume, setChosenResume] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  // An untouched job type shows the preferred one. An untouched resume shows the placeholder and is not sent: the
  // application is added with no resume, and only a resume the person picks (or "None") counts as their choice.
  const employmentType = chosenType ?? preferredType;
  const resumeItems = resumes.data?.items ?? [];
  const noResumes = resumes.isSuccess && resumeItems.length === 0;
  const resumeValue = chosenResume ?? (noResumes ? NO_RESUME : null);

  /** A field's error goes as soon as the field changes (submitting checks it again). */
  const clearError = (field: FieldName) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!title.trim()) next.title = 'Required';
    if (!companyName.trim()) next.companyName = 'Required';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;
    onSavingChange(true);
    try {
      const created = await trackerApi.create({
        title: title.trim(),
        companyName: companyName.trim(),
        location: location.trim(),
        employmentType,
        status,
        ...(chosenResume !== null ? { resumeId: chosenResume === NO_RESUME ? null : chosenResume } : {}),
        occurredOn: localToday(),
      });
      onAdded(created);
    } catch (error) {
      if (isApiError(error) && error.fields) {
        const fields = error.fields;
        setErrors(Object.fromEntries(FIELD_NAMES.filter((name) => fields[name]).map((name) => [name, fields[name]])));
      }
      setFailure(userMessage(error, "We couldn't add the application. Please try again."));
    } finally {
      onSavingChange(false);
    }
  };

  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field label="Position Title" required error={errors.title}>
        <Input
          value={title}
          placeholder="Title"
          autoComplete="off"
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            clearError('title');
          }}
        />
      </Field>
      <Field label="Company" required error={errors.companyName}>
        <CompanyInput
          value={companyName}
          onValueChange={(value) => {
            setCompanyName(value);
            clearError('companyName');
          }}
        />
      </Field>
      <Field label="Location" error={errors.location}>
        <Input
          value={location}
          placeholder="Location"
          autoComplete="off"
          maxLength={200}
          onChange={(event) => {
            setLocation(event.target.value);
            clearError('location');
          }}
        />
      </Field>
      <Field label="Job Type" required error={errors.employmentType}>
        <Select
          options={JOB_TYPE_OPTIONS}
          value={employmentType}
          onValueChange={(value) => {
            setChosenType(value);
            clearError('employmentType');
          }}
        />
      </Field>
      <Field label="Job Status" error={errors.status}>
        <Select
          options={statusOptions()}
          value={String(status)}
          onValueChange={(value) => {
            setStatus(Number(value) as ApplicationStatus);
            clearError('status');
          }}
        />
      </Field>
      <Field
        label="Resume used"
        error={errors.resumeId}
        hint={resumes.isError ? "Your resumes can't be listed right now. You can link one later from the application." : undefined}
      >
        <Select
          options={[
            { value: NO_RESUME, label: resumeItems.length > 0 ? 'None' : 'No resumes found' },
            ...resumeItems.map((resume) => ({
              value: resume.id,
              label: resume.isDefault ? `${resume.label} (Default)` : resume.label,
              textValue: resume.label,
            })),
          ]}
          value={resumeValue}
          placeholder="Resume used for this application"
          disabled={resumeItems.length === 0}
          onValueChange={(value) => {
            setChosenResume(value);
            clearError('resumeId');
          }}
        />
      </Field>
      {failure && <Notice tone="error">{failure}</Notice>}
    </form>
  );
}

/**
 * Simplify's "Add Application": a right sheet (max-w-3xl) with a briefcase badge. Saving opens the new application's
 * detail in edit mode, where the link, pay and description are entered.
 */
export function AddApplicationSheet({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (application: ApplicationDetail) => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Add Application"
        icon={<BriefcaseIcon size={20} />}
        size="3xl"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              Add
            </Button>
          </>
        }
      >
        {open && (
          <AddApplicationForm
            onSavingChange={setSaving}
            onAdded={(application) => {
              onOpenChange(false);
              onAdded(application);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
