'use client';

import { WORK_ARRANGEMENTS, WORK_ARRANGEMENT_LABEL, countryDisplayName, jobFilterCounts, type JobsQuery } from '@tailorit/shared';
import { clsx } from 'clsx';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { FilterPill } from '@/components/ui/FilterPill';
import { CheckIcon, MapPinIcon, PlusIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { toggled } from '../filters';
import { useFacet } from '../hooks';
import { useDebouncedValue } from './useDebouncedValue';

/** "Remote in …" options when the data has no remote postings yet. */
const DEFAULT_REMOTE = ['US', 'CA', 'GB'];

export interface LocationFieldsProps {
  query: Pick<JobsQuery, 'locations' | 'remote' | 'arrangements'>;
  onChange: (patch: Partial<JobsQuery>) => void;
  /** Hide the work-arrangement chips (All filters shows them in their own row). */
  withArrangements?: boolean;
}

const GROUP_LABEL = 'text-xs leading-4 font-medium text-muted-foreground';

/**
 * Places ("City, state, or country", with suggestions and job counts), "Remote in USA/Canada/UK/…" and the work
 * arrangement. Every choice applies at once.
 */
export function LocationFields({ query, onChange, withArrangements = true }: LocationFieldsProps) {
  const [text, setText] = useState('');
  const search = useDebouncedValue(text.trim(), 200);
  const places = useFacet('locations', search);
  const remote = useFacet('remoteCountries', '');

  const add = (place: string) => {
    const value = place.trim();
    if (!value) return;
    if (!query.locations.some((item) => item.toLowerCase() === value.toLowerCase())) {
      onChange({ locations: [...query.locations, value] });
    }
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add(text);
    }
  };

  const suggestions = (places.data?.items ?? []).slice(0, 8);
  const typed = text.trim();
  const typedIsListed = suggestions.some((item) => item.label.toLowerCase() === typed.toLowerCase());
  const remoteOptions = (remote.data?.items.length ?? 0) > 0
    ? remote.data!.items.map((item) => ({ value: item.value, label: item.label }))
    : DEFAULT_REMOTE.map((code) => ({ value: code, label: `Remote in ${countryDisplayName(code)}` }));
  // A country chosen elsewhere (a link, a saved search) stays visible so it can be turned off.
  if (query.remote && !remoteOptions.some((option) => option.value === query.remote)) {
    remoteOptions.push({ value: query.remote, label: `Remote in ${countryDisplayName(query.remote)}` });
  }

  return (
    <div className="flex flex-col">
      <div className="p-3">
        <Input
          aria-label="City, state, or country"
          placeholder="City, state, or country"
          leading={<MapPinIcon size={16} />}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query.locations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {query.locations.map((place) => (
              <Chip
                key={place}
                size="sm"
                tone="neutral"
                onRemove={() => onChange({ locations: query.locations.filter((item) => item !== place) })}
                removeLabel={`Remove ${place}`}
              >
                {place}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <ul className="max-h-[216px] overflow-y-auto border-t border-border p-1.5" aria-label="Suggested places">
        {typed && !typedIsListed && (
          <li>
            <button
              type="button"
              onClick={() => add(typed)}
              className="flex min-h-8 w-full items-center gap-2.5 rounded-menu-row px-1.5 py-1.5 text-left text-sm hover:bg-hover"
            >
              <PlusIcon size={14} className="text-muted-foreground" />
              <span className="truncate">Search for &ldquo;{typed}&rdquo;</span>
            </button>
          </li>
        )}
        {suggestions.map((item) => {
          const on = query.locations.some((place) => place.toLowerCase() === item.value.toLowerCase());
          return (
            <li key={item.value}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  on
                    ? onChange({ locations: query.locations.filter((place) => place.toLowerCase() !== item.value.toLowerCase()) })
                    : add(item.value)
                }
                className="flex min-h-8 w-full items-center gap-2.5 rounded-menu-row px-1.5 py-1.5 text-left text-sm hover:bg-hover"
              >
                <span className={clsx('flex size-3.5 shrink-0', on ? 'text-primary-ink' : 'text-transparent')}>
                  <CheckIcon size={14} weight="bold" />
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{item.count.toLocaleString('en-US')}</span>
              </button>
            </li>
          );
        })}
        {!typed && suggestions.length === 0 && !places.isPending && (
          <li className="px-1.5 py-1.5 text-sm text-muted-foreground">Type a city, state, or country.</li>
        )}
        {typed && suggestions.length === 0 && !places.isFetching && (
          <li className="px-1.5 py-1 text-xs text-muted-foreground">No postings name that place yet.</li>
        )}
      </ul>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <p className={GROUP_LABEL}>Remote</p>
        <div className="flex flex-wrap gap-1.5">
          {remoteOptions.map((option) => (
            <Chip
              key={option.value}
              size="sm"
              selected={query.remote === option.value}
              onClick={() => onChange({ remote: query.remote === option.value ? undefined : option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        {withArrangements && (
          <>
            <p className={clsx(GROUP_LABEL, 'mt-2')}>Work arrangement</p>
            <div className="flex flex-wrap gap-1.5">
              {WORK_ARRANGEMENTS.map((arrangement) => {
                const on = query.arrangements.includes(arrangement);
                return (
                  <Chip
                    key={arrangement}
                    size="sm"
                    selected={on}
                    onClick={() => onChange({ arrangements: toggled(query.arrangements, arrangement, !on) })}
                  >
                    {WORK_ARRANGEMENT_LABEL[arrangement]}
                  </Chip>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The toolbar's "Location ⇕" pill and its panel. */
export function LocationFilter({ query, onChange }: { query: JobsQuery; onChange: (patch: Partial<JobsQuery>) => void }) {
  const count = jobFilterCounts(query).location;
  return (
    <Popover>
      <PopoverTrigger render={<FilterPill label="Location" count={count} active={count > 0} />} />
      <PopoverContent align="start" padding="none" className="w-[340px]" aria-label="Location">
        <LocationFields query={query} onChange={onChange} />
        {count > 0 && (
          <div className="flex justify-end border-t border-border px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => onChange({ locations: [], remote: undefined, arrangements: [] })}>
              Clear location
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
