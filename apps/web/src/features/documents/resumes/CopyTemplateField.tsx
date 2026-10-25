'use client';

import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { Select, type SelectOption } from '@/components/ui/Select';
import { printsClassicOnly, type TemplateInfo } from '../../resume-editor/api';
import { FALLBACK_TEMPLATE_NAME } from '../../resume-editor/draft';

/**
 * The Upload dialog's "Template for the copy" (one file) or "Template for the copies" (several), under "Make an
 * editable copy with AI" while it is ticked: every template offered, by name, and what the chosen one does not print.
 * While the list loads nothing can be picked and the copy starts on the server's standard template; when it cannot be
 * loaded, the copies start on Professional Two-Column, and the picker says so.
 */
export function CopyTemplateField({
  several,
  templates,
  status,
  value,
  onChange,
  disabled,
}: {
  several: boolean;
  templates: readonly TemplateInfo[];
  status: 'loading' | 'ready' | 'error';
  /** The template the copies start on (null until the list is ready). */
  value: string | null;
  onChange: (templateId: string) => void;
  disabled?: boolean;
}) {
  const options: SelectOption<string>[] = templates.map((template) => ({ value: template.id, label: template.name }));
  const selected = status === 'ready' ? (templates.find((template) => template.id === value) ?? null) : null;
  let hint: string | undefined;
  if (status === 'ready') {
    hint = several
      ? 'Every copy starts on this template. You can switch any of them later in the editor.'
      : 'The copy starts on this template. You can switch it later in the editor.';
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={several ? 'Template for the copies' : 'Template for the copy'} hint={hint}>
        <Select
          options={options}
          value={status === 'ready' ? value : null}
          onValueChange={onChange}
          placeholder={status === 'loading' ? 'Loading templates...' : FALLBACK_TEMPLATE_NAME}
          disabled={disabled || status !== 'ready'}
        />
      </Field>
      {status === 'error' && (
        <Notice tone="warning">
          {several
            ? `The template list could not be loaded, so the copies start on ${FALLBACK_TEMPLATE_NAME}. You can switch each one later in the editor.`
            : `The template list could not be loaded, so the copy starts on ${FALLBACK_TEMPLATE_NAME}. You can switch it later in the editor.`}
        </Notice>
      )}
      {selected && printsClassicOnly(selected) && (
        <Notice tone="info">
          {selected.name} prints the classic sections only: projects, languages, awards and sections of your own are kept
          with the {several ? 'copies' : 'copy'} but not printed.
        </Notice>
      )}
    </div>
  );
}
