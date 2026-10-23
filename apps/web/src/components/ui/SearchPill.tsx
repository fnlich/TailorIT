'use client';

import { clsx } from 'clsx';
import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes } from 'react';
import { MagnifyingGlassIcon, XIcon } from './icons';

export interface SearchPillProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string;
  onValueChange: (value: string) => void;
  /** The accessible name; defaults to the placeholder. */
  label?: string;
  /** Shows an ✕ that empties the field (and keeps focus in it) while there is text. */
  clearable?: boolean;
  className?: string;
}

/**
 * Simplify's search: a white rounded-full field with a magnifier ("Find your dream role", "Search for roles or
 * companies"), 36 px tall, #e8e8e8 border, soft shadow.
 */
export const SearchPill = forwardRef<HTMLInputElement, SearchPillProps>(function SearchPill(
  { value, onValueChange, label, clearable = true, placeholder = 'Search', className, ...rest },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  return (
    <div className={clsx('relative flex h-9 min-w-0 items-center', className)}>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 text-muted-foreground" size={16} />
      <input
        ref={input}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className={clsx(
          'h-9 w-full min-w-0 rounded-full border border-border bg-surface pr-9 pl-9 text-[15px] text-foreground shadow-soft',
          'outline-none transition-[border-color] duration-150 hover:border-control-hover focus:border-control-focus focus-visible:outline-none',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
        {...rest}
      />
      {clearable && value !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange('');
            input.current?.focus();
          }}
          className="absolute right-2 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
});
