'use client';

import { Select as BaseSelect } from '@base-ui/react/select';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useFieldControl } from './Field';
import { CaretDownIcon, CheckIcon } from './icons';
import { CONTROL_SURFACE, type InputSize } from './Input';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from './styles';

export interface SelectOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Plain text for typeahead when `label` is not a string. */
  textValue?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string> {
  options: readonly SelectOption<V>[];
  value: V | null;
  onValueChange: (value: V) => void;
  placeholder?: string;
  /** Needed when there is no visible label (and no surrounding Field). */
  'aria-label'?: string;
  disabled?: boolean;
  name?: string;
  size?: InputSize;
  /** Width/margins of the trigger, e.g. "w-32". */
  className?: string;
  /** Extra classes for the popup (e.g. a fixed width). */
  popupClassName?: string;
  id?: string;
}

const TRIGGER_SIZES: Record<InputSize, string> = { sm: 'h-8', md: 'h-9', lg: 'h-10' };

/**
 * A single-choice dropdown (Simplify's "All ⌄" source filter, "Status ⌄"). The list opens under the trigger at
 * least as wide as it; the chosen option carries a check.
 */
export function Select<V extends string>({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  disabled,
  name,
  size = 'md',
  className,
  popupClassName,
  id,
  ...aria
}: SelectProps<V>) {
  const field = useFieldControl({ id });
  const items = options.map((option) => ({ value: option.value, label: option.label }));
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as V);
      }}
      disabled={disabled}
      name={name}
      modal={false}
    >
      <BaseSelect.Trigger
        id={field.id}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-label'] ? undefined : field.labelId}
        aria-describedby={field['aria-describedby']}
        className={clsx(
          CONTROL_SURFACE,
          TRIGGER_SIZES[size],
          'flex min-w-0 items-center justify-between gap-2 pr-2.5 pl-3 text-left',
          'data-popup-open:border-control-focus',
          className,
        )}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="min-w-0 truncate data-placeholder:text-subtle-foreground"
        />
        <BaseSelect.Icon className="flex text-muted-foreground">
          <CaretDownIcon size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner alignItemWithTrigger={false} sideOffset={6} className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseSelect.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto overscroll-contain',
              popupClassName,
            )}
          >
            <BaseSelect.List className="outline-none">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)}
                  disabled={option.disabled}
                  className={clsx(MENU_ROW, 'relative pr-8 data-selected:font-medium')}
                >
                  {option.icon && <span className="flex text-muted-foreground">{option.icon}</span>}
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="absolute right-2.5 flex text-primary-ink">
                    <CheckIcon size={14} weight="bold" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
