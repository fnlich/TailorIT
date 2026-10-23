'use client';

import { useState, type ReactElement } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import 'react-day-picker/style.css';
import { Button } from './Button';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export interface DatePickerPopoverProps {
  value: Date | null;
  onValueChange: (date: Date | null) => void;
  /** The trigger (a ref-forwarding element: Button, FilterPill, IconButton…). */
  children: ReactElement;
  /** Latest selectable day (status dates: no future days). */
  maxDate?: Date;
  minDate?: Date;
  /**
   * With actions the pick is staged until "Save" and "Clear" empties the date (Simplify's status-date popover).
   * Without, a pick applies at once and closes the popover.
   */
  withActions?: boolean;
  clearLabel?: string;
  saveLabel?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  'aria-label'?: string;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A calendar in a popover (month/year dropdowns), themed with the kit tokens (.ti-day-picker in globals.css). */
export function DatePickerPopover({
  value,
  onValueChange,
  children,
  maxDate,
  minDate,
  withActions = false,
  clearLabel = 'Clear',
  saveLabel = 'Save',
  side = 'bottom',
  align = 'start',
  ...aria
}: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(value);

  const disabled: Matcher[] = [];
  if (maxDate) disabled.push({ after: startOfDay(maxDate) });
  if (minDate) disabled.push({ before: startOfDay(minDate) });

  // Fixed bounds for the year dropdown (reading the clock during render is not allowed).
  const endMonth = maxDate ?? new Date(2040, 11);
  const startMonth = minDate ?? new Date(1980, 0);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger render={children} />
      <PopoverContent side={side} align={align} padding="sm" aria-label={aria['aria-label'] ?? 'Choose a date'}>
        <DayPicker
          className="ti-day-picker"
          mode="single"
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          defaultMonth={(withActions ? draft : value) ?? maxDate ?? undefined}
          selected={(withActions ? draft : value) ?? undefined}
          onSelect={(date) => {
            if (withActions) {
              setDraft(date ?? null);
              return;
            }
            onValueChange(date ?? null);
            setOpen(false);
          }}
          disabled={disabled}
        />
        {withActions && (
          <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onValueChange(null);
                setOpen(false);
              }}
            >
              {clearLabel}
            </Button>
            <Button
              size="sm"
              disabled={!draft}
              onClick={() => {
                onValueChange(draft);
                setOpen(false);
              }}
            >
              {saveLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
