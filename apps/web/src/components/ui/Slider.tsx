'use client';

import { Slider as BaseSlider } from '@base-ui/react/slider';
import { clsx } from 'clsx';

interface SliderBaseProps {
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Accessible names, one per thumb. */
  thumbLabels: string[];
  /** Spoken value, e.g. (v) => "$120k". */
  formatValue?: (value: number) => string;
  className?: string;
}

export interface SliderProps extends SliderBaseProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Fires once the drag ends (save here instead of on every step). */
  onValueCommitted?: (value: number) => void;
}

export interface RangeSliderProps extends SliderBaseProps {
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  onValueCommitted?: (value: [number, number]) => void;
}

const THUMB =
  'size-[18px] rounded-full border border-control-strong bg-white shadow-[0_1px_3px_rgb(0_0_0/0.15)] outline-none ' +
  'transition-[box-shadow] duration-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ' +
  'data-dragging:shadow-[0_0_0_4px_rgb(20_161_192/0.18)]';

function Track({ thumbs, thumbLabels, formatValue }: { thumbs: number; thumbLabels: string[]; formatValue?: (v: number) => string }) {
  return (
    <BaseSlider.Control className="flex w-full touch-none items-center py-2.5 select-none data-disabled:opacity-50">
      <BaseSlider.Track className="h-1 w-full rounded-full bg-border select-none">
        <BaseSlider.Indicator className="rounded-full bg-primary select-none" />
        {Array.from({ length: thumbs }, (_, index) => (
          <BaseSlider.Thumb
            key={index}
            index={thumbs > 1 ? index : undefined}
            aria-label={thumbLabels[index]}
            getAriaValueText={formatValue ? (_formatted, value) => formatValue(value) : undefined}
            className={THUMB}
          />
        ))}
      </BaseSlider.Track>
    </BaseSlider.Control>
  );
}

/** A single-value slider (e.g. minimum salary $0–400k). */
export function Slider({ value, onValueChange, onValueCommitted, min = 0, max = 100, step = 1, disabled, thumbLabels, formatValue, className }: SliderProps) {
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(next) => onValueChange(Array.isArray(next) ? (next[0] ?? min) : next)}
      onValueCommitted={
        onValueCommitted ? (next) => onValueCommitted(Array.isArray(next) ? (next[0] ?? min) : next) : undefined
      }
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx('w-full', className)}
    >
      <Track thumbs={1} thumbLabels={thumbLabels} formatValue={formatValue} />
    </BaseSlider.Root>
  );
}

/** A two-thumb range slider. */
export function RangeSlider({ value, onValueChange, onValueCommitted, min = 0, max = 100, step = 1, disabled, thumbLabels, formatValue, className }: RangeSliderProps) {
  const pair = (next: number | readonly number[]): [number, number] =>
    Array.isArray(next) ? [next[0] ?? min, next[1] ?? max] : [next as number, max];
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(next) => onValueChange(pair(next))}
      onValueCommitted={onValueCommitted ? (next) => onValueCommitted(pair(next)) : undefined}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx('w-full', className)}
    >
      <Track thumbs={2} thumbLabels={thumbLabels} formatValue={formatValue} />
    </BaseSlider.Root>
  );
}
