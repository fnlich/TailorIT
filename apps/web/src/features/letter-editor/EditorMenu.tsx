'use client';

import { Fragment, useRef, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { ListIcon } from './icons';
import { LETTER_UPLOAD_ACCEPT } from './UploadButton';

export interface EditorMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
  ruleBefore?: boolean;
  /** Opens the file picker (.pdf, .docx) and hands the chosen file to `onFile` instead of running onSelect. */
  onFile?: (file: File) => void;
}

/** The ☰ menu at the right of an editor bar (Export to PDF, Import from PDF/DOCX, New …, Delete this …). */
export function EditorMenu({ items, label = 'More options' }: { items: readonly EditorMenuItem[]; label?: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const fileHandler = useRef<((file: File) => void) | null>(null);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<IconButton label={label} variant="outline" tooltip={false} icon={<ListIcon size={18} />} data-editor-menu="" />}
        />
        <MenuContent align="end" width="w-56" aria-label={label}>
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.ruleBefore && <MenuSeparator />}
              <MenuItem
                icon={item.icon}
                tone={item.tone === 'danger' ? 'danger' : 'default'}
                disabled={item.disabled}
                onClick={() => {
                  if (item.onFile) {
                    fileHandler.current = item.onFile;
                    fileInput.current?.click();
                    return;
                  }
                  item.onSelect();
                }}
              >
                {item.label}
              </MenuItem>
            </Fragment>
          ))}
        </MenuContent>
      </Menu>
      <input
        ref={fileInput}
        type="file"
        accept={LETTER_UPLOAD_ACCEPT}
        hidden
        data-editor-import=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) fileHandler.current?.(file);
        }}
      />
    </>
  );
}
