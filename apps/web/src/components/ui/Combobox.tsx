'use client';

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { useFieldControl } from './Field';
import { CaretDownIcon, CheckIcon, PlusIcon } from './icons';
import { CONTROL_SURFACE } from './Input';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from './styles';

interface ComboItem {
  value: string;
  label: string;
  /** Set on the synthetic "Create "…"" row: the text to create. */
  creatable?: string;
}

export interface ComboboxProps {
  /** The values to pick from (e.g. company names). */
  options: readonly string[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  /** Offers `Create "<typed text>"` when nothing matches exactly. */
  creatable?: boolean;
  /** Called with the typed text when the create row is picked (the value changes to it as well). */
  onCreate?: (label: string) => void;
  createLabel?: (query: string) => string;
  emptyText?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const sameItem = (a: ComboItem, b: ComboItem) => a.value === b.value;

/**
 * A filterable single choice with an optional "Create" row (Simplify's Company field in "Add Application").
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  creatable = false,
  onCreate,
  createLabel = (query) => `Create "${query}"`,
  emptyText = 'No results',
  disabled,
  className,
  id,
  ...aria
}: ComboboxProps) {
  const field = useFieldControl({ id });
  const [query, setQuery] = useState(value ?? '');

  const baseItems = useMemo<ComboItem[]>(() => options.map((option) => ({ value: option, label: option })), [options]);
  const selected = useMemo<ComboItem | null>(
    () => (value === null ? null : (baseItems.find((item) => item.value === value) ?? { value, label: value })),
    [baseItems, value],
  );

  const trimmed = query.trim();
  const hasExact =
    trimmed === '' || baseItems.some((item) => item.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  const items: ComboItem[] =
    creatable && !hasExact
      ? [...baseItems, { value: `create:${trimmed}`, label: createLabel(trimmed), creatable: trimmed }]
      : baseItems;

  return (
    <BaseCombobox.Root<ComboItem>
      items={items}
      value={selected}
      isItemEqualToValue={sameItem}
      itemToStringLabel={(item) => (item.creatable ?? item.label)}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(next) => {
        if (next?.creatable) {
          onCreate?.(next.creatable);
          onValueChange(next.creatable);
          return;
        }
        onValueChange(next?.value ?? null);
      }}
      disabled={disabled}
    >
      <div className={clsx('relative flex items-center', className ?? 'w-full')}>
        <BaseCombobox.Input
          id={field.id}
          placeholder={placeholder}
          aria-label={aria['aria-label']}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid']}
          className={clsx(CONTROL_SURFACE, 'h-9 w-full min-w-0 pr-9 pl-3')}
        />
        <BaseCombobox.Trigger
          aria-label="Show options"
          className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
        >
          <CaretDownIcon size={14} />
        </BaseCombobox.Trigger>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={6} className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseCombobox.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-[min(20rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) overflow-y-auto overscroll-contain',
            )}
          >
            <BaseCombobox.Empty className="px-1.5 py-2 text-sm text-muted-foreground empty:hidden">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="outline-none">
              {(item: ComboItem) => (
                <BaseCombobox.Item key={item.value} value={item} className={clsx(MENU_ROW, 'relative pr-8')}>
                  {item.creatable ? (
                    <>
                      <PlusIcon size={14} className="text-primary-ink" />
                      <span className="min-w-0 flex-1 truncate font-medium text-primary-ink">{item.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <BaseCombobox.ItemIndicator className="absolute right-2.5 flex text-primary-ink">
                        <CheckIcon size={14} weight="bold" />
                      </BaseCombobox.ItemIndicator>
                    </>
                  )}
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
