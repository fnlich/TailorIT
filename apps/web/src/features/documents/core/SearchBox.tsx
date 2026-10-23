'use client';

import { useRef } from 'react';
import { MagnifyingGlassIcon, XIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';

/**
 * A collection's search field (Simplify's plain "Search" box in the table toolbar). The ✕ clears it and hands focus
 * back to the field, which would otherwise fall to the page when the button disappears.
 */
export function SearchBox({
  value,
  onValueChange,
  label,
  placeholder = 'Search',
  withIcon = false,
  id,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The accessible name, e.g. "Search resumes". */
  label: string;
  placeholder?: string;
  withIcon?: boolean;
  id?: string;
  /** Width / layout classes for the field. */
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Input
      ref={input}
      id={id}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      wrapperClassName={className}
      className="[&::-webkit-search-cancel-button]:appearance-none"
      leading={withIcon ? <MagnifyingGlassIcon size={16} /> : undefined}
      // Always a trailing slot, so the field keeps its element (and focus) when the ✕ appears.
      trailing={
        value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onValueChange('');
              input.current?.focus();
            }}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <XIcon size={14} />
          </button>
        ) : (
          <span aria-hidden="true" />
        )
      }
    />
  );
}
