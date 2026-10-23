'use client';

import { hasJobFilters, type JobsQuery } from '@tailorit/shared';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { XIcon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/IconButton';
import { SearchPill } from '@/components/ui/SearchPill';
import { AllFiltersDialog } from './AllFiltersDialog';
import { CategoryFilter } from './CategoryFilter';
import { ExperienceLevelFilter, JobTypeFilter } from './ChoiceFilters';
import { LocationFilter } from './LocationFilter';
import { SavedSearches } from './SavedSearches';

/** How long typing rests before the list searches. */
const SEARCH_DELAY_MS = 350;

/**
 * "Find your dream role": typing searches after a short pause, Enter at once. The box follows the address when it
 * changes elsewhere (Clear all, a saved search, back).
 */
function SearchBox({ q, onSearch, className }: { q: string; onSearch: (q: string) => void; className?: string }) {
  const [text, setText] = useState(q);
  const sent = useRef(q);
  const search = useRef(onSearch);
  useEffect(() => {
    search.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    if (q !== sent.current) {
      sent.current = q;
      setText(q);
    }
  }, [q]);

  useEffect(() => {
    const value = text.trim();
    if (value === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = value;
      search.current(value);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <SearchPill
      value={text}
      onValueChange={setText}
      placeholder="Find your dream role"
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        const value = text.trim();
        sent.current = value;
        onSearch(value);
      }}
      className={className}
    />
  );
}

function Divider({ className }: { className?: string }) {
  return <span aria-hidden="true" data-toolbar-divider className={clsx('h-5 w-px shrink-0 bg-border', className)} />;
}

export interface JobsToolbarProps {
  query: JobsQuery;
  onChange: (patch: Partial<JobsQuery>) => void;
  onReplace: (query: JobsQuery) => void;
  onClearAll: () => void;
  className?: string;
}

/**
 * The toolbar on the canvas: the search pill (as wide as the list panel), then right-aligned Location ⇕, Job Type,
 * Experience Level and Category pills, All filters, the saved-search bookmark and ✕ (clear all). When the row wraps
 * (narrow screens), All filters, the bookmark and ✕ move as one group, and no divider is left at a row's end.
 */
export function JobsToolbar({ query, onChange, onReplace, onClearAll, className }: JobsToolbarProps) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-3', className)} role="search" aria-label="Job search">
      <SearchBox
        q={query.q ?? ''}
        onSearch={(q) => onChange({ q: q || undefined })}
        className="w-full lg:w-1/3"
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <LocationFilter query={query} onChange={onChange} />
        <JobTypeFilter query={query} onChange={onChange} />
        <ExperienceLevelFilter query={query} onChange={onChange} />
        <CategoryFilter query={query} onChange={onChange} />
        <Divider className="hidden lg:block" />
        <div className="flex items-center gap-2">
          <AllFiltersDialog query={query} onApply={onReplace} />
          <Divider />
          <SavedSearches query={query} onApply={onReplace} />
          <IconButton
            label="Clear all filters"
            tooltip="Clear all"
            variant="outline"
            shape="round"
            icon={<XIcon size={18} weight="bold" />}
            disabled={!hasJobFilters(query)}
            onClick={onClearAll}
          />
        </div>
      </div>
    </div>
  );
}
