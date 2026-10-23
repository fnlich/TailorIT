'use client';

import { MAX_CUSTOM_SECTION_TITLE_LENGTH, entrySummary, type SectionKind, type SectionSpec } from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Field } from '@/components/ui/Field';
import { CaretRightIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { missingEndDateHint, type DraftEntry } from '../draft';
import { AddRowButton, NotPrintedNote } from './parts';
import { SectionCard, type CardFrame } from './SectionCard';

/**
 * The card of every kind that is a list of entries (Experience, Education, …, and each custom section): one row per
 * entry, its title over its dates and place (and, for a start date with no end, the amber "Add an end date…" hint),
 * opened in the Edit Entry panel; the dashed "+ Add {entry}" under them.
 * A custom section edits its title here. `header` is what a card puts above its rows (Strengths: its switch), and
 * `showRows` is false while that switch is off.
 */
export function EntrySection({
  sectionRef,
  kind,
  label,
  spec,
  entries,
  onOpen,
  onAdd,
  frame,
  templatePrints,
  templateName,
  header,
  showRows = true,
  customTitle,
}: {
  sectionRef: string;
  kind: SectionKind | 'custom';
  label: string;
  spec: SectionSpec;
  entries: readonly DraftEntry[];
  onOpen: (key: string) => void;
  onAdd: () => void;
  frame: CardFrame;
  /** Whether the chosen template prints the section; null while unknown. */
  templatePrints: boolean | null;
  templateName: string;
  header?: ReactNode;
  showRows?: boolean;
  customTitle?: { id: string; value: string; onChange: (value: string) => void };
}) {
  return (
    <SectionCard sectionRef={sectionRef} label={label} icon={spec.icon} description={spec.description} frame={frame}>
      {customTitle && (
        <Field label="Section title" id={customTitle.id}>
          <Input
            value={customTitle.value}
            maxLength={MAX_CUSTOM_SECTION_TITLE_LENGTH}
            placeholder="e.g. Patents"
            onChange={(event) => customTitle.onChange(event.target.value)}
          />
        </Field>
      )}
      {header}
      {showRows && (
        <>
          <NotPrintedNote prints={templatePrints} count={entries.length} label={label} templateName={templateName} />
          {entries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {entries.map((row, index) => {
                const summary = entrySummary(kind, row, index);
                const endDateHint = missingEndDateHint(kind, row);
                const hintId = `${sectionRef}-${row.key}-end-date`;
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(row.key)}
                      aria-label={`Edit ${summary.title}`}
                      aria-describedby={endDateHint ? hintId : undefined}
                      className={clsx(
                        'group/row flex w-full items-center gap-3 rounded-control border border-border bg-surface px-3.5 py-2.5 text-left',
                        'transition-colors duration-150 hover:border-control-hover hover:bg-surface-low',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className={clsx(
                            'truncate text-sm leading-5 font-semibold',
                            summary.untitled ? 'text-muted-foreground italic' : 'text-foreground',
                          )}
                        >
                          {summary.title}
                        </span>
                        {summary.meta && <span className="truncate text-[13px] leading-5 text-muted-foreground">{summary.meta}</span>}
                        {endDateHint && (
                          <span id={hintId} className="mt-0.5 text-[13px] leading-5 text-amber-foreground" data-end-date-hint="">
                            {endDateHint}
                          </span>
                        )}
                      </span>
                      <CaretRightIcon size={16} className="shrink-0 text-subtle-foreground transition-colors group-hover/row:text-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <AddRowButton onClick={onAdd}>Add {spec.entryNoun}</AddRowButton>
        </>
      )}
    </SectionCard>
  );
}
