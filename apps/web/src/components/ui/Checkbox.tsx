'use client';

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { clsx } from 'clsx';
import { forwardRef, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { useFieldControl } from './Field';
import { CheckIcon, MinusIcon } from './icons';

export interface CheckboxProps {
  checked: boolean;
  /** `shiftKey` is true when the click that toggled it held Shift (range selection in lists). */
  onCheckedChange: (checked: boolean, details: { shiftKey: boolean }) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  /** Renders the box with a text label beside it, the whole row clickable. */
  label?: ReactNode;
  /** Stops the click from reaching a clickable row underneath. */
  stopPropagation?: boolean;
}

/** Simplify's 18 px checkbox: white, #d1d1d1 border, radius 5; checked = #14a1c0 with a white tick. */
export const Checkbox = forwardRef<HTMLSpanElement, CheckboxProps>(function Checkbox(
  {
    checked,
    onCheckedChange,
    indeterminate = false,
    disabled,
    name,
    value,
    id,
    className,
    label,
    stopPropagation,
    ...aria
  },
  ref,
) {
  const field = useFieldControl({ id });
  const labelTextId = useId();
  // Base UI runs a consumer's click handler before it dispatches the change, so Shift is read here.
  const shift = useRef(false);
  const box = (
    <BaseCheckbox.Root
      ref={ref}
      id={field.id}
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      name={name}
      value={value}
      aria-label={aria['aria-label']}
      aria-labelledby={label ? labelTextId : (aria['aria-labelledby'] ?? (aria['aria-label'] ? undefined : field.labelId))}
      aria-describedby={field['aria-describedby']}
      onMouseDown={(event: MouseEvent) => {
        // Shift-click selects a range of rows; without this the browser also selects the text between them.
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event: MouseEvent) => {
        shift.current = event.shiftKey;
        if (stopPropagation) event.stopPropagation();
      }}
      onCheckedChange={(next) => {
        onCheckedChange(next, { shiftKey: shift.current });
        shift.current = false;
      }}
      className={clsx(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-checkbox bg-surface text-white',
        'shadow-control transition-[background-color,border-color] duration-100 hover:border-control-focus',
        'data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-40',
        !label && className,
      )}
    >
      <BaseCheckbox.Indicator className="flex">
        {indeterminate ? <MinusIcon size={12} weight="bold" /> : <CheckIcon size={12} weight="bold" />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
  if (!label) return box;
  return (
    <label
      className={clsx(
        'inline-flex items-center gap-2.5 text-sm text-foreground',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {box}
      <span id={labelTextId}>{label}</span>
    </label>
  );
});
