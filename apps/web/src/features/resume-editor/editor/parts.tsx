'use client';

import { clsx } from 'clsx';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { CaretLeftIcon, CheckIcon, PlusIcon, SparkleIcon, XIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import type { ResumeDraft } from '../draft';

/*
 * Small pieces the editor's cards share, so they read as one form.
 */

/**
 * How a card changes the draft. `immediate` marks a discrete choice (a template, a layout, a switch, a card moved),
 * which the preview draws at once instead of waiting out the typing pause.
 */
export type UpdateDraft = (recipe: (draft: ResumeDraft) => ResumeDraft, options?: { immediate?: boolean }) => void;

/** A text box with an Add button that also adds on Enter (and never submits anything else). */
export function ChipInput({
  id,
  value,
  onChange,
  onAdd,
  placeholder,
  label,
  list,
  maxLength,
  disabled,
  busy,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  /** The accessible name of the box. */
  label: string;
  /** A <datalist> id (the skill library). */
  list?: string;
  maxLength?: number;
  disabled?: boolean;
  busy?: boolean;
  /** A refusal ("Go is already on the list."). */
  error?: string | null;
}) {
  const errorId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!busy) onAdd();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            value={value}
            list={list}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
          />
        </div>
        <Button variant="outline" onClick={onAdd} disabled={disabled || busy || !value.trim()} loading={busy}>
          {busy ? 'Adding...' : 'Add'}
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-[13px] leading-5 text-[#c62a29]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Removable chips; `renderExtra` puts a control inside a chip, before its ✕ (the heading select). */
export function ChipList({
  items,
  onRemove,
  renderExtra,
  tone = 'tint',
  label,
}: {
  items: readonly string[];
  onRemove: (item: string) => void;
  renderExtra?: (item: string) => ReactNode;
  tone?: 'tint' | 'neutral';
  /** Names the list for assistive tech ("Technical skills"). */
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        // The index joins the key: a stored list may hold a name twice; a chip has no state to lose.
        <li
          key={`${index}:${item}`}
          className={clsx(
            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full py-1 pr-1 pl-3 text-[13px] leading-5 font-medium',
            tone === 'tint' ? 'bg-primary-container text-primary-ink' : 'bg-chip text-foreground',
          )}
        >
          <span className="truncate">{item}</span>
          {renderExtra?.(item)}
          <button
            type="button"
            onClick={() => onRemove(item)}
            aria-label={`Remove ${item}`}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full opacity-70 transition-[opacity,background-color] hover:bg-black/[0.08] hover:opacity-100"
          >
            <XIcon size={11} weight="bold" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A section's print switch: what turning it on does, beside the switch itself. The whole row toggles it. */
export function SwitchRow({
  id,
  checked,
  onCheckedChange,
  title,
  children,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'flex items-start gap-4 rounded-control border px-3.5 py-3 transition-colors',
        checked ? 'border-primary-200 bg-primary-50' : 'border-border bg-surface-low',
      )}
    >
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
        <span className="text-sm leading-5 font-semibold text-foreground">{title}</span>
        {children && <span className="text-[13px] leading-5 text-muted-foreground">{children}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={title} className="mt-0.5" />
    </div>
  );
}

/** What a switched-off section keeps ("2 soft skills kept with the resume…"). */
export function KeptLine({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <p role="status" className="text-[13px] leading-5 text-muted-foreground">
      {note}
    </p>
  );
}

/** The note under a switch that is on while the template has no such section (it prints as if off). */
export function SwitchCapabilityNote({
  on,
  supported,
  section,
  templateName,
}: {
  on: boolean;
  /** Whether the chosen template has the section; null while unknown. */
  supported: boolean | null;
  section: string;
  templateName: string;
}) {
  if (!on || supported !== false) return null;
  return (
    <Notice tone="warning">
      {templateName} has no {section} section, so it prints as if this were off. Another template prints it.
    </Notice>
  );
}

/** The note on a card whose section the chosen template does not print (nothing while it is empty or unknown). */
export function NotPrintedNote({
  prints,
  count,
  label,
  templateName,
}: {
  prints: boolean | null;
  count: number;
  label: string;
  templateName: string;
}) {
  if (prints !== false || count === 0) return null;
  const one = count === 1;
  return (
    <Notice tone="info">
      {templateName} has no {label} section, so {one ? 'this entry is' : 'these entries are'} not printed with it.{' '}
      {one ? 'It is' : 'They are'} saved with the resume, and another template prints {one ? 'it' : 'them'}.
    </Notice>
  );
}

/** "+ Add {entry}" under a card's rows: dashed, full width, teal. */
export function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-10 w-full items-center justify-center gap-2 rounded-control border border-dashed border-control-strong text-sm font-semibold text-primary-ink',
        'transition-colors duration-150 hover:border-primary hover:bg-primary-50',
      )}
    >
      <PlusIcon size={16} weight="bold" />
      {children}
    </button>
  );
}

/** One card of the Customize tab: a title, what it decides, its fields. */
export function SettingsCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-surface border border-border bg-surface p-5 shadow-soft">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base leading-6 font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="text-[13px] leading-5 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The panel that takes the column's place while one thing is edited (an entry, or the name and contact details):
 * Back, the section's name over the title, the panel's own actions (Delete), the fields, and Done pinned to the
 * bottom of the window while the panel is longer than it.
 */
export function EditorPanel({
  title,
  eyebrow,
  onBack,
  actions,
  onDone,
  children,
}: {
  title: string;
  eyebrow?: string;
  onBack: () => void;
  actions?: ReactNode;
  onDone: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-surface border border-border bg-surface shadow-soft">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <IconButton label="Back to the sections" icon={<CaretLeftIcon size={18} />} variant="outline" shape="round" onClick={onBack} />
        <div className="flex min-w-0 flex-1 flex-col">
          {eyebrow && <p className="truncate text-xs leading-4 font-medium text-muted-foreground">{eyebrow}</p>}
          <h2 id={headingId} className="truncate text-lg leading-7 font-semibold text-foreground">
            {title}
          </h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="@container flex flex-col gap-5 px-4 py-5 sm:px-5">{children}</div>
      <div className="sticky bottom-0 z-[1] flex justify-end rounded-b-surface border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
        <Button onClick={onDone} icon={<CheckIcon size={16} weight="bold" />} className="min-w-28">
          Done
        </Button>
      </div>
    </section>
  );
}

/** Write with AI / Improve with AI: Simplify's "Improve your resume" tint, a sparkle, a spinner while it runs. */
export function AiButton({
  children,
  onClick,
  disabled,
  running,
  describedBy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  running?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      aria-describedby={describedBy}
      aria-busy={running || undefined}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-control border border-improve-border bg-improve px-3.5 text-sm font-semibold whitespace-nowrap text-primary-ink',
        'transition-colors duration-150 hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {running ? <Spinner size={16} /> : <SparkleIcon size={16} weight="fill" />}
      {children}
    </button>
  );
}
