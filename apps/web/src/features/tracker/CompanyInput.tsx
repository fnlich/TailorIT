'use client';

import { Autocomplete } from '@base-ui/react/autocomplete';
import { clsx } from 'clsx';
import { useFieldControl } from '@/components/ui/Field';
import { CONTROL_SURFACE } from '@/components/ui/Input';
import { CaretDownIcon } from '@/components/ui/icons';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from '@/components/ui/styles';
import { useCompanyNames } from './data';
import { useDebouncedValue } from './hooks';

/**
 * The Company field of Add Application and Edit Job Posting: free text with suggestions from the companies the
 * account tracks and the job board knows. Simplify's is a creatable combobox; here whatever is typed is the value, so
 * a new company never needs an extra "Create" pick (and is never lost on blur).
 */
export function CompanyInput({
  value,
  onValueChange,
  placeholder = 'Company',
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const field = useFieldControl({ id });
  const suggestions = useCompanyNames(useDebouncedValue(value, 250));
  const options = suggestions.data?.items ?? [];
  return (
    <Autocomplete.Root items={options} value={value} onValueChange={(next) => onValueChange(next)} openOnInputClick limit={50}>
      <div className="relative flex w-full items-center">
        <Autocomplete.Input
          id={field.id}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={200}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid']}
          className={clsx(CONTROL_SURFACE, 'h-9 w-full min-w-0 pr-9 pl-3')}
        />
        <Autocomplete.Trigger
          aria-label="Show companies"
          className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
        >
          <CaretDownIcon size={14} />
        </Autocomplete.Trigger>
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={6} className={clsx(Z_FLOATING, 'outline-none')}>
          <Autocomplete.Popup
            className={clsx(
              MENU_SURFACE,
              'max-h-[min(20rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) overflow-y-auto overscroll-contain',
            )}
          >
            <Autocomplete.Empty className="px-1.5 py-2 text-sm text-muted-foreground empty:hidden">
              {value.trim() ? `"${value.trim()}" will be added as a new company.` : 'Type a company name.'}
            </Autocomplete.Empty>
            <Autocomplete.List className="outline-none">
              {(item: string) => (
                <Autocomplete.Item key={item} value={item} className={MENU_ROW}>
                  <span className="min-w-0 flex-1 truncate">{item}</span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
