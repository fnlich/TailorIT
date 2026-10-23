'use client';

import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABEL,
  type EmploymentType,
  type ExperienceLevel,
  type JobsQuery,
} from '@tailorit/shared';
import { FilterPill } from '@/components/ui/FilterPill';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { toggled } from '../filters';

interface ChoiceMenuProps<V extends string> {
  label: string;
  /** "Clear job type" */
  clearLabel: string;
  values: readonly V[];
  labels: Record<V, string>;
  chosen: readonly V[];
  onChange: (next: V[]) => void;
}

/** A pill whose menu is a checkbox list ("Job Type [1]", "Experience Level ⇕"); the menu stays open while ticking. */
function ChoiceMenu<V extends string>({ label, clearLabel, values, labels, chosen, onChange }: ChoiceMenuProps<V>) {
  return (
    <Menu>
      <MenuTrigger render={<FilterPill label={label} count={chosen.length} active={chosen.length > 0} />} />
      <MenuContent align="start" width="w-60" aria-label={label}>
        {values.map((value) => (
          <MenuCheckboxItem
            key={value}
            checked={chosen.includes(value)}
            onCheckedChange={(on) => onChange(toggled(chosen, value, on))}
          >
            {labels[value]}
          </MenuCheckboxItem>
        ))}
        {chosen.length > 0 && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange([])}>{clearLabel}</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export function JobTypeFilter({ query, onChange }: { query: JobsQuery; onChange: (patch: Partial<JobsQuery>) => void }) {
  return (
    <ChoiceMenu<EmploymentType>
      label="Job Type"
      clearLabel="Clear job type"
      values={EMPLOYMENT_TYPES}
      labels={EMPLOYMENT_TYPE_LABEL}
      chosen={query.jobTypes}
      onChange={(jobTypes) => onChange({ jobTypes })}
    />
  );
}

export function ExperienceLevelFilter({ query, onChange }: { query: JobsQuery; onChange: (patch: Partial<JobsQuery>) => void }) {
  return (
    <ChoiceMenu<ExperienceLevel>
      label="Experience Level"
      clearLabel="Clear experience level"
      values={EXPERIENCE_LEVELS}
      labels={EXPERIENCE_LEVEL_LABEL}
      chosen={query.levels}
      onChange={(levels) => onChange({ levels })}
    />
  );
}
