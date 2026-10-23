'use client';

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { clsx } from 'clsx';
import { useState } from 'react';
import { variablesByGroup, type VariableDefinition } from '@tailorit/shared/letters';
import { MENU_GROUP_LABEL, MENU_ROW, MENU_SURFACE, Z_FLOATING } from '@/components/ui/styles';
import { SHELL, ShellIndicator } from '../letter-editor/controlShell';

/*
 * "Insert variable...": every registry variable, grouped Profile / Dynamic / Structural / AI Generated, searchable by
 * label, name or description. Choosing one inserts its chip at the cursor and clears the field.
 */

interface VariableGroupItems {
  value: string;
  items: VariableDefinition[];
}

const GROUPS: VariableGroupItems[] = variablesByGroup().map((group) => ({ value: group.label, items: group.variables }));

function matches(variable: VariableDefinition, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/[{}]/g, '');
  if (!needle) return true;
  return [variable.label, variable.name, variable.description].some((field) => field.toLowerCase().includes(needle));
}

export function InsertVariableSelect({ onInsert, disabled }: { onInsert: (name: string) => void; disabled?: boolean }) {
  const [input, setInput] = useState('');
  const filtered = GROUPS.map((group) => ({ ...group, items: group.items.filter((variable) => matches(variable, input)) })).filter(
    (group) => group.items.length > 0,
  );

  return (
    <BaseCombobox.Root<VariableDefinition>
      items={GROUPS}
      filteredItems={filtered}
      value={null}
      inputValue={input}
      onInputValueChange={setInput}
      itemToStringLabel={(variable) => variable.label}
      isItemEqualToValue={(a, b) => a.name === b.name}
      onValueChange={(variable) => {
        if (!variable) return;
        onInsert(variable.name);
        setInput('');
      }}
      disabled={disabled}
      autoHighlight
    >
      <div className={clsx(SHELL, 'w-full sm:w-[284px]')} data-insert-variable="">
        <BaseCombobox.Input
          aria-label="Insert variable"
          placeholder="Insert variable..."
          className="h-full min-w-0 flex-1 rounded-[6px] bg-transparent pl-2.5 text-[14px] outline-none placeholder:text-[#8f8f8f]"
        />
        <BaseCombobox.Trigger aria-label="Show variables" className="flex h-full items-center rounded-r-[6px] outline-offset-0">
          <ShellIndicator />
        </BaseCombobox.Trigger>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={6} align="start" className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseCombobox.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-[min(24rem,var(--available-height))] w-[min(22rem,var(--available-width))] overflow-y-auto overscroll-contain',
            )}
          >
            <BaseCombobox.Empty className="px-1.5 py-2 text-sm text-muted-foreground empty:hidden">No variables match.</BaseCombobox.Empty>
            <BaseCombobox.List className="outline-none">
              {(group: VariableGroupItems) => (
                <BaseCombobox.Group key={group.value} items={group.items} className="pb-1">
                  <BaseCombobox.GroupLabel className={MENU_GROUP_LABEL}>{group.value}</BaseCombobox.GroupLabel>
                  <BaseCombobox.Collection>
                    {(variable: VariableDefinition) => (
                      <BaseCombobox.Item key={variable.name} value={variable} className={MENU_ROW}>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex w-full items-center gap-2">
                            <span className="font-medium">{variable.label}</span>
                            <span className="ml-auto truncate rounded-[4px] bg-sky px-1.5 text-[11px] leading-[18px] font-medium text-sky-foreground">
                              {`{{${variable.name}}}`}
                            </span>
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">{variable.description}</span>
                        </span>
                      </BaseCombobox.Item>
                    )}
                  </BaseCombobox.Collection>
                </BaseCombobox.Group>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
