'use client';

import { GithubLogoIcon } from '@phosphor-icons/react/GithubLogo';
import { GlobeIcon } from '@phosphor-icons/react/Globe';
import { LinkedinLogoIcon } from '@phosphor-icons/react/LinkedinLogo';
import { PhoneIcon } from '@phosphor-icons/react/Phone';
import { clsx } from 'clsx';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { EnvelopeIcon, MapPinIcon, PencilSimpleIcon, UserIcon, type Icon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { lettersOf } from '@/components/ui/LetterAvatar';
import type { DraftContact, ResumeDraft } from '../draft';
import { EditorPanel, type UpdateDraft } from './parts';

const CONTACT_LINES: Array<{ key: keyof DraftContact; icon: Icon }> = [
  { key: 'email', icon: EnvelopeIcon },
  { key: 'phone', icon: PhoneIcon },
  { key: 'location', icon: MapPinIcon },
  { key: 'linkedin', icon: LinkedinLogoIcon },
  { key: 'github', icon: GithubLogoIcon },
  { key: 'portfolio', icon: GlobeIcon },
];

/**
 * The top of the resume, as the Content tab shows it: the name, the headline, one line per contact detail and the
 * pencil that opens "Name and contact details". Fixed at the top (the header is not a section and does not move).
 */
export function EditorHeaderCard({ draft, onEdit }: { draft: ResumeDraft; onEdit: () => void }) {
  const name = draft.name.trim();
  const title = draft.title.trim();
  const contact = CONTACT_LINES.map((line) => ({ ...line, value: draft.contact[line.key].trim() })).filter((line) => line.value);
  return (
    <section
      aria-label="Name and contact details"
      className="flex items-start gap-4 rounded-surface border border-border bg-surface p-5 shadow-soft"
    >
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-container text-lg font-bold text-primary-ink"
      >
        {name ? lettersOf(name, 2) : <UserIcon size={24} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={clsx('truncate text-xl leading-7 font-bold', name ? 'text-foreground' : 'text-subtle-foreground')}>
          {name || 'Your name'}
        </p>
        <p className={clsx('truncate text-sm leading-5', title ? 'text-foreground' : 'text-subtle-foreground')}>
          {title || 'Your professional title'}
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {contact.length > 0 ? (
            contact.map(({ key, icon: Glyph, value }) => (
              <li key={key} className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
                <Glyph size={15} className="shrink-0" />
                <span className="max-w-[16rem] truncate">{value}</span>
              </li>
            ))
          ) : (
            <li className="text-[13px] leading-5 text-subtle-foreground">No contact details yet</li>
          )}
        </ul>
      </div>
      <IconButton
        label="Edit name and contact details"
        icon={<PencilSimpleIcon size={17} />}
        variant="outline"
        shape="round"
        onClick={onEdit}
      />
    </section>
  );
}

const CONTACT_FIELDS: Array<{
  key: keyof DraftContact;
  label: string;
  type: 'email' | 'tel' | 'text';
  inputMode?: 'url';
  placeholder: string;
  autoComplete: string;
}> = [
  { key: 'email', label: 'Email', type: 'email', placeholder: 'e.g. jordan.chen@example.com', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', placeholder: 'e.g. +1 (555) 123-4567', autoComplete: 'tel' },
  { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. San Francisco, CA', autoComplete: 'off' },
  // Text, not url: the browser's url check refuses "linkedin.com/in/you", which is how most people write it.
  { key: 'linkedin', label: 'LinkedIn URL', type: 'text', inputMode: 'url', placeholder: 'linkedin.com/in/you', autoComplete: 'url' },
  { key: 'github', label: 'GitHub URL', type: 'text', inputMode: 'url', placeholder: 'github.com/you', autoComplete: 'url' },
  { key: 'portfolio', label: 'Portfolio URL', type: 'text', inputMode: 'url', placeholder: 'yoursite.com', autoComplete: 'url' },
];

/** "Name and contact details": the name, headline and years at the top of the resume, and the contact line. */
export function BasicsPanel({ draft, update, onDone }: { draft: ResumeDraft; update: UpdateDraft; onDone: () => void }) {
  return (
    <EditorPanel title="Name and contact details" eyebrow="Personal details" onBack={onDone} onDone={onDone}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 @lg:grid-cols-2">
        <Field label="Full name" id="resume-name">
          <Input
            value={draft.name}
            placeholder="e.g. Jordan Avery Chen"
            autoComplete="off"
            autoFocus
            onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Professional title" id="resume-title">
          <Input
            value={draft.title}
            placeholder="e.g. Senior Software Engineer"
            autoComplete="off"
            onChange={(event) => update((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Total years of experience" id="resume-years" hint="Helps Write with AI pitch your bullets. Not printed by itself.">
          <Input
            type="number"
            min={0}
            max={80}
            step={0.5}
            inputMode="decimal"
            value={draft.totalYearsExperience}
            placeholder="e.g. 4"
            onChange={(event) => update((current) => ({ ...current, totalYearsExperience: event.target.value }))}
          />
        </Field>
        {CONTACT_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} id={`resume-contact-${field.key}`}>
            <Input
              type={field.type}
              inputMode={field.inputMode}
              value={draft.contact[field.key]}
              placeholder={field.placeholder}
              autoComplete={field.autoComplete}
              onChange={(event) =>
                update((current) => ({ ...current, contact: { ...current.contact, [field.key]: event.target.value } }))
              }
            />
          </Field>
        ))}
      </div>
    </EditorPanel>
  );
}
