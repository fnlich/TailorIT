'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';
import { useFieldControl } from './Field';

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  options: readonly RadioOption<V>[];
  value: V | null;
  onValueChange: (value: V) => void;
  orientation?: 'vertical' | 'horizontal';
  'aria-label'?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
}

/** One choice of several, each a labelled 18 px radio (#14a1c0 when chosen). */
export function RadioGroup<V extends string>({
  options,
  value,
  onValueChange,
  orientation = 'vertical',
  disabled,
  name,
  className,
  ...aria
}: RadioGroupProps<V>) {
  const field = useFieldControl({});
  const baseId = useId();
  return (
    <BaseRadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      disabled={disabled}
      name={name}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-label'] ? undefined : field.labelId}
      aria-describedby={field['aria-describedby']}
      className={clsx(orientation === 'vertical' ? 'flex flex-col gap-2.5' : 'flex flex-wrap gap-x-5 gap-y-2.5', className)}
    >
      {options.map((option, index) => {
        const labelId = `${baseId}-${index}`;
        return (
          <label
            key={option.value}
            className={clsx(
              'flex items-start gap-2.5 text-sm text-foreground',
              option.disabled || disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <Radio.Root
              value={option.value}
              disabled={option.disabled}
              aria-labelledby={labelId}
              className={clsx(
                'mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-checkbox bg-surface shadow-control',
                'transition-colors duration-100 hover:border-control-focus data-checked:border-primary',
              )}
            >
              <Radio.Indicator className="size-2.5 rounded-full bg-primary" />
            </Radio.Root>
            <span className="flex flex-col gap-0.5">
              <span id={labelId} className="leading-5">
                {option.label}
              </span>
              {option.description && <span className="text-[13px] text-muted-foreground">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </BaseRadioGroup>
  );
}
