'use client';

import { Input as BaseInput } from '@base-ui/react/input';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useFieldControl } from './Field';

export type InputSize = 'sm' | 'md' | 'lg';

/** Simplify's field: 36 px, radius 10, border #e6e6e6 → #d7d7d7 on hover → #969696 on focus, no ring. */
export const CONTROL_SURFACE =
  'rounded-control border border-control bg-surface text-sm text-foreground shadow-soft outline-none ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-control-hover focus:border-control-focus ' +
  'focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-low disabled:text-muted-foreground ' +
  'aria-[invalid=true]:border-[#e88a89] aria-[invalid=true]:focus:border-[#c62a29]';

const SIZES: Record<InputSize, string> = { sm: 'h-8', md: 'h-9', lg: 'h-10' };

export interface InputProps extends Omit<ComponentPropsWithoutRef<typeof BaseInput>, 'size' | 'className'> {
  size?: InputSize;
  /** An icon or text inside the left edge (e.g. a magnifier or "$"). */
  leading?: ReactNode;
  /** An icon or button inside the right edge. */
  trailing?: ReactNode;
  className?: string;
  /** Classes for the wrapper that holds `leading` / `trailing`. */
  wrapperClassName?: string;
}

/**
 * A text field. It fills its container: size it with a wrapper (or `wrapperClassName` when it has a leading or
 * trailing slot) rather than a width in `className`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leading, trailing, className, wrapperClassName, id, ...rest },
  ref,
) {
  const field = useFieldControl({
    id,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'] as boolean | undefined,
  });
  const input = (
    <BaseInput
      ref={ref}
      {...rest}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
      className={clsx(
        CONTROL_SURFACE,
        SIZES[size],
        'w-full min-w-0 px-3',
        leading ? 'pl-9' : undefined,
        trailing ? 'pr-9' : undefined,
        className,
      )}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={clsx('relative flex items-center', wrapperClassName ?? 'w-full')}>
      {leading && (
        <span className="pointer-events-none absolute left-3 flex items-center text-muted-foreground">{leading}</span>
      )}
      {input}
      {trailing && <span className="absolute right-2 flex items-center">{trailing}</span>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content (CSS field-sizing) instead of offering a resize handle. */
  autoGrow?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = false, id, rows = 4, ...rest },
  ref,
) {
  const field = useFieldControl({
    id,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'] as boolean | undefined,
  });
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...rest}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
      className={clsx(
        CONTROL_SURFACE,
        'block w-full min-w-0 px-3 py-2 leading-5',
        autoGrow ? '[field-sizing:content] min-h-20 resize-none' : 'resize-y',
        className,
      )}
    />
  );
});
