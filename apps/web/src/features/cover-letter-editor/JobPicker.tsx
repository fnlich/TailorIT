'use client';

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { ApplicationListResponseSchema, type ApplicationListResponse, type ApplicationSummary } from '@tailorit/shared/tracker';
import { CheckIcon, MagnifyingGlassIcon } from '@/components/ui/icons';
import { CONTROL_SURFACE } from '@/components/ui/Input';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from '@/components/ui/styles';
import { api, isApiError } from '@/lib/api';

/*
 * "Select a job from tracker": a search over the person's tracked applications (GET /api/applications?q=). Picking
 * one fills Company Name, Job Title and Job Description, and the field keeps showing the job picked (or the one the
 * letter is already linked to), so it is clear where the details came from. When the tracker's API is not there
 * (yet), the field says so instead of failing.
 */

const labelOf = (application: ApplicationSummary) => `${application.title} · ${application.companyName}`;

export function JobPicker({
  id,
  selected,
  onPick,
}: {
  id?: string;
  /** The job the details came from: picked here, or the tracked application the letter belongs to. */
  selected: ApplicationSummary | null;
  onPick: (application: ApplicationSummary) => void;
}) {
  const [input, setInput] = useState(selected ? labelOf(selected) : '');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // A selection that arrives or changes from outside (the linked job loading) shows in the field.
  const [shownId, setShownId] = useState(selected?.id ?? null);
  if (selected && selected.id !== shownId) {
    setShownId(selected.id);
    setInput(labelOf(selected));
  }

  // The field showing the selection is not a search: the list then offers every tracked job.
  const typed = selected && input === labelOf(selected) ? '' : input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed), 250);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const query = useQuery({
    queryKey: ['cover-letter', 'job-picker', search],
    queryFn: ({ signal }) =>
      api.get<ApplicationListResponse>('/api/applications', {
        query: { q: search || undefined, limit: 20, tab: 'active' },
        schema: ApplicationListResponseSchema,
        signal,
      }),
    enabled: open || search !== '',
    retry: false,
    staleTime: 30_000,
  });
  const missing = query.isError && isApiError(query.error) && (query.error.status === 404 || query.error.status === 405);
  const items = query.data?.items ?? [];

  if (missing) {
    return (
      <input
        id={id}
        disabled
        placeholder="Your tracked jobs will appear here"
        className={clsx(CONTROL_SURFACE, 'h-9 w-full px-3')}
      />
    );
  }

  return (
    <BaseCombobox.Root<ApplicationSummary>
      items={items}
      filteredItems={items}
      filter={null}
      value={selected}
      open={open}
      onOpenChange={setOpen}
      inputValue={input}
      onInputValueChange={setInput}
      itemToStringLabel={labelOf}
      isItemEqualToValue={(a, b) => a.id === b.id}
      onValueChange={(application) => {
        if (!application) return;
        onPick(application);
        setShownId(application.id);
        setInput(labelOf(application));
        setOpen(false);
      }}
    >
      <div className="relative flex w-full items-center">
        <span className="pointer-events-none absolute left-3 flex text-muted-foreground">
          <MagnifyingGlassIcon size={16} />
        </span>
        <BaseCombobox.Input id={id} placeholder="Search a job" className={clsx(CONTROL_SURFACE, 'h-9 w-full min-w-0 pr-3 pl-9')} />
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={6} className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseCombobox.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-[min(18rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) overflow-y-auto overscroll-contain',
            )}
          >
            <p className="px-1.5 py-2 text-sm text-muted-foreground empty:hidden">
              {query.isFetching && items.length === 0
                ? 'Searching...'
                : query.isError
                  ? 'Your tracked jobs could not be loaded.'
                  : items.length === 0
                    ? search
                      ? 'No tracked jobs match.'
                      : 'No tracked jobs yet. Add one in the Job Tracker.'
                    : ''}
            </p>
            <BaseCombobox.List className="outline-none">
              {(application: ApplicationSummary) => (
                <BaseCombobox.Item key={application.id} value={application} className={clsx(MENU_ROW, 'relative pr-8')}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{application.title}</span>
                    <span className="truncate text-xs leading-4 text-muted-foreground">{application.companyName}</span>
                  </span>
                  <BaseCombobox.ItemIndicator className="absolute right-2.5 flex text-primary-ink">
                    <CheckIcon size={14} weight="bold" />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
