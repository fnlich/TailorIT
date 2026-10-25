'use client';

import { TEMPLATE_CATEGORY_LABEL, type TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CheckIcon, MinusIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { Select, type SelectOption } from '@/components/ui/Select';
import { printsClassicOnly, type TemplateInfo } from '../api';
import { SettingsCard } from './parts';

/**
 * The Customize tab's Template card: the picker (every template prints any resume), what the chosen one prints, and
 * what happens when the resume's own template is no longer offered.
 */
export function TemplateSettings({
  templates,
  status,
  selectedId,
  onSelect,
}: {
  templates: readonly TemplateInfo[];
  status: 'loading' | 'ready' | 'error';
  /** The template the draft is drawn with. */
  selectedId: string;
  onSelect: (templateId: string) => void;
}) {
  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const failed = status === 'error' || (status === 'ready' && templates.length === 0);
  const options: SelectOption<string>[] = templates.map((template) => ({ value: template.id, label: template.name }));
  if (status === 'ready' && !selected && selectedId) {
    options.unshift({ value: selectedId, label: `${selectedId} (no longer available)`, disabled: true });
  }
  return (
    <SettingsCard title="Template" description="How the resume looks. The preview redraws as soon as you pick one.">
      <Field label="Design template" id="resume-template">
        <Select
          options={options}
          value={status === 'loading' ? null : selectedId}
          onValueChange={onSelect}
          placeholder={status === 'loading' ? 'Loading templates...' : 'Choose a template'}
          disabled={status !== 'ready' || failed}
        />
      </Field>
      {failed && (
        <Notice tone="warning">
          The template list could not be loaded, so another one cannot be picked right now. The preview still draws with this
          resume&apos;s template; reload the page to try again.
        </Notice>
      )}
      {status === 'ready' && !failed && !selected && (
        <Notice tone="warning">
          The template this resume used is no longer offered, so it is drawn with another one: the preview says which. Pick one
          here to choose it yourself.
        </Notice>
      )}
      {selected && (
        <div className="flex flex-col gap-3">
          {selected.description && <p className="text-[13px] leading-5 text-muted-foreground">{selected.description}</p>}
          <div className="flex flex-wrap gap-2">
            {selected.category && <Badge tone="tint">{TEMPLATE_CATEGORY_LABEL[selected.category]}</Badge>}
            <Capability on={selected.supportsStrengths} yes="Strengths section" no="No Strengths section" />
            <Capability on={selected.supportsSoftSkills} yes="Soft Skills section" no="No Soft Skills section" />
          </div>
          {printsClassicOnly(selected) && (
            <Notice tone="info">
              {selected.name} prints the classic sections only: projects, languages, awards and sections of your own are kept
              with the resume but not printed with it.
            </Notice>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

function Capability({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return (
    <Badge tone={on ? 'success' : 'neutral'} icon={on ? <CheckIcon size={12} weight="bold" /> : <MinusIcon size={12} weight="bold" />}>
      {on ? yes : no}
    </Badge>
  );
}

const LAYOUT_OPTIONS = [
  {
    value: 'categorized' as const,
    label: 'Grouped',
    description: 'Skills under headings. Pick a heading for any skill on the Technical skills card, or let the library file it.',
  },
  { value: 'flat' as const, label: 'Plain', description: 'One list of skill names with no headings over it.' },
];

/**
 * The Customize tab's Layout card: how Technical skills is laid out (every template prints both) and the section
 * order, with "Use the template's order" while the resume keeps an order of its own.
 */
export function LayoutSettings({
  layout,
  onLayoutChange,
  ownOrder,
  onUseTemplateOrder,
}: {
  layout: TechnicalSkillsLayout;
  onLayoutChange: (layout: TechnicalSkillsLayout) => void;
  ownOrder: boolean;
  onUseTemplateOrder: () => void;
}) {
  return (
    <SettingsCard title="Layout" description="How Technical skills is laid out, and the order the sections print in.">
      <Field label="Technical skills layout">
        <RadioGroup<TechnicalSkillsLayout> options={LAYOUT_OPTIONS} value={layout} onValueChange={onLayoutChange} name="resume-technical-skills-layout" />
      </Field>
      <div className="flex flex-col items-start gap-3 rounded-control bg-surface-low px-3.5 py-3">
        <p className="text-[13px] leading-5 text-muted-foreground">
          Sections print in the order of the cards on the Content tab, within the column the template puts each one in: a
          sidebar template keeps Skills in its sidebar wherever its card sits.
        </p>
        {ownOrder && (
          <Button variant="outline" size="sm" onClick={onUseTemplateOrder}>
            Use the template&apos;s order
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
