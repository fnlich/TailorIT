'use client';

import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';
import { useFieldControl } from './Field';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  /** Put the label before the switch (settings rows). */
  labelPosition?: 'start' | 'end';
  'aria-label'?: string;
  id?: string;
  className?: string;
}

/** An on/off toggle: 36×20 track, #d7d7d7 off, #14a1c0 on, white thumb. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  labelPosition = 'end',
  id,
  className,
  ...aria
}: SwitchProps) {
  const field = useFieldControl({ id });
  const labelId = useId();
  const control = (
    <BaseSwitch.Root
      id={field.id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      aria-label={aria['aria-label']}
      aria-labelledby={label ? labelId : aria['aria-label'] ? undefined : field.labelId}
      aria-describedby={field['aria-describedby']}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-control-strong p-0.5 transition-colors duration-150',
        'data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50',
        !label && className,
      )}
    >
      <BaseSwitch.Thumb className="size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-150 ease-out-soft data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );
  if (!label) return control;
  return (
    <label
      className={clsx(
        'inline-flex items-center gap-2.5 text-sm text-foreground',
        labelPosition === 'start' && 'flex-row-reverse justify-end',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {control}
      <span id={labelId}>{label}</span>
    </label>
  );
}
