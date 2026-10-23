'use client';

import { Select as BaseSelect } from '@base-ui/react/select';
import { clsx } from 'clsx';
import { LETTER_FONTS, type LetterFontName } from '@tailorit/shared/letters';
import { CheckIcon } from '@/components/ui/icons';
import { MENU_ROW, MENU_SURFACE, Z_FLOATING } from '@/components/ui/styles';
import { Tooltip } from '@/components/ui/Tooltip';
import { SHELL, ShellIndicator } from './controlShell';

/** The toolbar's font select: the ten letter fonts, each shown in its own face. */
export function FontSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: LetterFontName;
  onValueChange: (font: LetterFontName) => void;
  disabled?: boolean;
}) {
  const items = LETTER_FONTS.map((font) => ({ value: font.name, label: font.name }));
  const css = LETTER_FONTS.find((font) => font.name === value)?.css;
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as LetterFontName);
      }}
      disabled={disabled}
      modal={false}
    >
      <Tooltip content="Font">
        <BaseSelect.Trigger
          aria-label="Font"
          data-letter-font-select=""
          className={clsx(SHELL, 'w-44 shrink-0 pl-2.5 text-left focus-visible:outline-offset-1')}
        >
          <BaseSelect.Value className="min-w-0 flex-1 truncate" style={{ fontFamily: css }} />
          <ShellIndicator />
        </BaseSelect.Trigger>
      </Tooltip>
      <BaseSelect.Portal>
        <BaseSelect.Positioner alignItemWithTrigger={false} sideOffset={6} className={clsx(Z_FLOATING, 'outline-none')}>
          <BaseSelect.Popup
            className={clsx(MENU_SURFACE, 'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto overscroll-contain')}
          >
            <BaseSelect.List className="outline-none">
              {LETTER_FONTS.map((font) => (
                <BaseSelect.Item key={font.name} value={font.name} label={font.name} className={clsx(MENU_ROW, 'relative pr-8')}>
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate" style={{ fontFamily: font.css }}>
                    {font.name}
                  </BaseSelect.ItemText>
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
