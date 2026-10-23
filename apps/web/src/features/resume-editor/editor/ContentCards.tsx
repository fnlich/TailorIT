'use client';

import { SECTION_KIND_BY_ID, keptNote } from '@tailorit/shared/resume';
import { useState } from 'react';
import { Field } from '@/components/ui/Field';
import { CaretDownIcon } from '@/components/ui/icons';
import { Textarea } from '@/components/ui/Input';
import { userMessage } from '@/lib/api';
import {
  addTechnicalSkill,
  cleanChip,
  hasChip,
  headingOf,
  interestRefusal,
  keptCount,
  removeTechnicalSkill,
  setSkillHeading,
  softSkillRefusal,
  technicalSkillRefusal,
  type ResumeDraft,
} from '../draft';
import { ChipInput, ChipList, KeptLine, NotPrintedNote, SwitchCapabilityNote, SwitchRow, type UpdateDraft } from './parts';
import { SectionCard, type CardFrame } from './SectionCard';

/** The summary, typed straight into its card. */
export function SummaryCard({ draft, update, frame }: { draft: ResumeDraft; update: UpdateDraft; frame: CardFrame }) {
  const spec = SECTION_KIND_BY_ID.summary;
  return (
    <SectionCard sectionRef="summary" label={spec.label} icon={spec.icon} description={spec.description} frame={frame}>
      <Textarea
        id="resume-summary"
        rows={5}
        value={draft.summary}
        aria-label="Professional summary"
        placeholder="e.g. Senior engineer with nine years building and running payment platforms…"
        onChange={(event) => update((current) => ({ ...current, summary: event.target.value }))}
      />
    </SectionCard>
  );
}

/**
 * Technical skills: the skills, in the person's order, and in the Grouped layout the heading each goes under ("Auto
 * heading" lets the skill library file it). Skills the library does not know are added to the person's own list.
 */
export function TechnicalSkillsCard({
  draft,
  update,
  headingOptions,
  libraryListId,
  ensureLibrarySkill,
  frame,
}: {
  draft: ResumeDraft;
  update: UpdateDraft;
  headingOptions: readonly string[];
  libraryListId: string;
  ensureLibrarySkill: (skill: string) => Promise<string>;
  frame: CardFrame;
}) {
  const spec = SECTION_KIND_BY_ID.skills;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grouped = draft.settings.technicalSkillsLayout === 'categorized';
  const hasHeadings = draft.skills.some((skill) => headingOf(draft.skillCategoryBySkill, skill));

  const add = async () => {
    const value = cleanChip(input);
    if (!value) return;
    if (hasChip(draft.skills, value)) {
      setInput('');
      return;
    }
    const refusal = technicalSkillRefusal(draft.skills, value);
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const skill = await ensureLibrarySkill(value);
      update((current) => addTechnicalSkill(current, skill));
      setInput('');
    } catch (caught) {
      setError(userMessage(caught, 'Could not add that skill. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const hint = grouped
    ? 'Grouped prints each skill under a heading. "Auto heading" lets the skill library file it; pick a heading when you know better.'
    : hasHeadings
      ? 'Plain prints one list with no headings. The headings you picked are kept and come back with Grouped.'
      : 'Plain prints one list with no headings.';

  return (
    <SectionCard sectionRef="skills" label={spec.label} icon={spec.icon} description={spec.description} frame={frame}>
      <Field label="Skills" id="resume-hard-skill-input" hint={hint}>
        <ChipInput
          id="resume-hard-skill-input"
          list={libraryListId}
          value={input}
          onChange={(value) => {
            setInput(value);
            setError(null);
          }}
          onAdd={() => void add()}
          busy={busy}
          error={error}
          placeholder="Add a hard skill, e.g. TypeScript"
          label="Add a hard skill"
        />
      </Field>
      <ChipList
        label="Technical skills"
        items={draft.skills}
        onRemove={(skill) => update((current) => removeTechnicalSkill(current, skill))}
        renderExtra={
          grouped
            ? (skill) => (
                <HeadingSelect
                  skill={skill}
                  value={headingOf(draft.skillCategoryBySkill, skill)}
                  options={headingOptions}
                  onChange={(heading) => update((current) => setSkillHeading(current, skill, heading), { immediate: true })}
                />
              )
            : undefined
        }
      />
    </SectionCard>
  );
}

/** The heading a skill goes under, inside its chip: a small native select with its own caret. */
function HeadingSelect({
  skill,
  value,
  options,
  onChange,
}: {
  skill: string;
  value: string;
  options: readonly string[];
  onChange: (heading: string) => void;
}) {
  return (
    <span className="relative ml-1 inline-flex min-w-0">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`Heading for ${skill}`}
        title={value || 'Auto heading'}
        className="h-6 max-w-[10.5rem] min-w-0 cursor-pointer appearance-none truncate rounded-full border border-primary/25 bg-white/85 pr-6 pl-2 text-xs font-normal text-foreground outline-none hover:border-primary/50 focus-visible:border-primary-ink"
      >
        <option value="">Auto heading</option>
        {options.map((heading) => (
          <option key={heading} value={heading}>
            {heading}
          </option>
        ))}
      </select>
      <CaretDownIcon size={11} weight="bold" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

/** Soft skills: printed in their own section only while the switch is on; the list is kept either way. */
export function SoftSkillsCard({
  draft,
  update,
  templateSupports,
  templateName,
  frame,
}: {
  draft: ResumeDraft;
  update: UpdateDraft;
  templateSupports: boolean | null;
  templateName: string;
  frame: CardFrame;
}) {
  const spec = SECTION_KIND_BY_ID.softSkills;
  const [input, setInput] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const on = draft.settings.includeSoftSkills;

  const add = () => {
    const value = cleanChip(input);
    if (!value) return;
    const reason = softSkillRefusal(draft.softSkills, value);
    setRefusal(reason);
    if (reason) return;
    update((current) => ({ ...current, softSkills: [...current.softSkills, value] }));
    setInput('');
  };

  return (
    <SectionCard sectionRef="softSkills" label={spec.label} icon={spec.icon} frame={frame}>
      <SwitchRow
        id="resume-include-soft-skills"
        checked={on}
        title="Print a Soft Skills section"
        onCheckedChange={(checked) =>
          update((current) => ({ ...current, settings: { ...current.settings, includeSoftSkills: checked } }), { immediate: true })
        }
      >
        {on ? 'Your soft skills print in a section of their own, as you list them here.' : 'Off: no Soft Skills section is printed.'}
      </SwitchRow>
      <SwitchCapabilityNote on={on} supported={templateSupports} section="Soft Skills" templateName={templateName} />
      {on ? (
        <>
          <ChipInput
            id="resume-soft-skill-input"
            value={input}
            onChange={(value) => {
              setInput(value);
              setRefusal(null);
            }}
            onAdd={add}
            error={refusal}
            maxLength={100}
            placeholder="Add a soft skill, e.g. Stakeholder communication"
            label="Add a soft skill"
          />
          <ChipList
            label="Soft skills"
            tone="neutral"
            items={draft.softSkills}
            onRemove={(skill) => update((current) => ({ ...current, softSkills: current.softSkills.filter((item) => item !== skill) }))}
          />
        </>
      ) : (
        <KeptLine note={keptNote(keptCount(draft, 'softSkills'), 'softSkills')} />
      )}
    </SectionCard>
  );
}

/** Interests: a short chip list printed on one line. */
export function InterestsCard({
  draft,
  update,
  templatePrints,
  templateName,
  frame,
}: {
  draft: ResumeDraft;
  update: UpdateDraft;
  templatePrints: boolean | null;
  templateName: string;
  frame: CardFrame;
}) {
  const spec = SECTION_KIND_BY_ID.interests;
  const [input, setInput] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const add = () => {
    const value = cleanChip(input);
    if (!value) return;
    const reason = interestRefusal(draft.interests, value);
    setRefusal(reason);
    if (reason) return;
    update((current) => ({ ...current, interests: [...current.interests, value] }));
    setInput('');
  };

  return (
    <SectionCard sectionRef="interests" label={spec.label} icon={spec.icon} description={spec.description} frame={frame}>
      <NotPrintedNote prints={templatePrints} count={draft.interests.length} label={spec.heading} templateName={templateName} />
      <ChipInput
        id="resume-interest-input"
        value={input}
        onChange={(value) => {
          setInput(value);
          setRefusal(null);
        }}
        onAdd={add}
        error={refusal}
        maxLength={100}
        placeholder="Add an interest, e.g. Trail running"
        label="Add an interest"
      />
      <ChipList
        label="Interests"
        tone="neutral"
        items={draft.interests}
        onRemove={(item) => update((current) => ({ ...current, interests: current.interests.filter((entry) => entry !== item) }))}
      />
    </SectionCard>
  );
}
