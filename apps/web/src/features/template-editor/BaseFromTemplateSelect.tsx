'use client';

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { clsx } from 'clsx';
import { useState } from 'react';
import type { LetterTemplateSummary } from '@tailorit/shared/letters';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from '@/components/ui/styles';
import { Tooltip } from '@/components/ui/Tooltip';
import { SHELL, ShellIndicator } from '../letter-editor/controlShell';

/** "Base from template...": the other templates (starters included); choosing one asks the page to copy it in. */
export function BaseFromTemplateSelect({
  templates,
  onPick,
  disabled,
}: {
  templates: readonly LetterTemplateSummary[];
  onPick: (template: LetterTemplateSummary) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const needle = input.trim().toLowerCase();
  const filtered = needle ? templates.filter((template) => template.name.toLowerCase().includes(needle)) : templates;

  return (
    <BaseCombobox.Root<LetterTemplateSummary>
      items={templates as LetterTemplateSummary[]}
      filteredItems={filtered}
      value={null}
      inputValue={input}
      onInputValueChange={setInput}
      itemToStringLabel={(template) => template.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      onValueChange={(template) => {
        if (!template) return;
        onPick(template);
        setInput('');
      }}
      disabled={disabled}
      autoHighlight
    >
      <Tooltip content="Replace editor content with a copy of another template">
        <div className={clsx(SHELL, 'w-full sm:w-[284px]')} data-base-from-template="">
          <BaseCombobox.Input
            aria-label="Base from template"
            placeholder="Base from template..."
            className="h-full min-w-0 flex-1 rounded-[6px] bg-transparent pl-2.5 text-[14px] outline-none placeholder:text-[#8f8f8f]"
          />
          <BaseCombobox.Trigger aria-label="Show templates" className="flex h-full items-center rounded-r-[6px] outline-offset-0">
            <ShellIndicator />
          </BaseCombobox.Trigger>
        </div>
      </Tooltip>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={6} align="start" className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseCombobox.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-[min(20rem,var(--available-height))] w-(--anchor-width) min-w-64 max-w-(--available-width) overflow-y-auto overscroll-contain',
            )}
          >
            <BaseCombobox.Empty className="px-1.5 py-2 text-sm text-muted-foreground empty:hidden">No templates match.</BaseCombobox.Empty>
            <BaseCombobox.List className="outline-none">
              {(template: LetterTemplateSummary) => (
                <BaseCombobox.Item key={template.id} value={template} className={MENU_ROW}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{template.name}</span>
                      {template.isSystem && (
                        <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 text-[11px] leading-[18px] font-semibold">
                          System Default
                        </span>
                      )}
                    </span>
                    {template.preview && <span className="truncate text-xs leading-4 text-muted-foreground">{template.preview}</span>}
                  </span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
