'use client';

import {
  CUSTOM_SECTION_SPEC,
  MAX_CUSTOM_SECTION_TITLE_LENGTH,
  MAX_RESUME_CUSTOM_SECTIONS,
  type SectionKind,
  type SectionKindDefinition,
} from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SectionGlyph } from '../sectionIcons';

/**
 * "Add content": a tile per section kind the resume does not show yet, and a custom section under a title of the
 * person's own (at most ten). A tile adds the card at the end of the column, open, and closes the dialog.
 */
export function AddContentDialog({
  open,
  onOpenChange,
  available,
  customCount,
  onAddKind,
  onAddCustom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: readonly SectionKindDefinition[];
  customCount: number;
  onAddKind: (kind: SectionKind) => void;
  onAddCustom: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const atCap = customCount >= MAX_RESUME_CUSTOM_SECTIONS;

  const addCustom = () => {
    const name = title.trim();
    if (!name || atCap) return;
    setTitle('');
    onAddCustom(name);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTitle('');
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="xl"
        title="Add content"
        description="A section prints once it has an entry; an empty one stays on the page and is saved with the resume."
      >
        <div className="-mx-1 mt-5 flex max-h-[min(68vh,38rem)] flex-col gap-4 overflow-y-auto px-1 pb-1">
          {available.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {available.map((kind) => (
                <li key={kind.id}>
                  <button
                    type="button"
                    onClick={() => onAddKind(kind.id)}
                    className={clsx(
                      'flex h-full w-full items-start gap-3 rounded-[12px] border border-border bg-surface p-3.5 text-left',
                      'transition-[border-color,background-color] duration-150 hover:border-primary hover:bg-primary-50',
                    )}
                  >
                    <SectionGlyph icon={kind.icon} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm leading-5 font-semibold text-foreground">{kind.label}</span>
                      <span className="text-[13px] leading-[18px] text-muted-foreground">{kind.blurb}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Every kind of section is on the page already. A custom section can still be added.</p>
          )}
          <div className="flex items-start gap-3 rounded-[12px] border border-dashed border-control-strong bg-surface-low p-3.5">
            <SectionGlyph icon={CUSTOM_SECTION_SPEC.icon} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm leading-5 font-semibold text-foreground">{CUSTOM_SECTION_SPEC.label}</p>
              <p className="text-[13px] leading-[18px] text-muted-foreground">{CUSTOM_SECTION_SPEC.blurb}</p>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label="Custom section title"
                    placeholder="Section title, e.g. Patents"
                    maxLength={MAX_CUSTOM_SECTION_TITLE_LENGTH}
                    value={title}
                    disabled={atCap}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      addCustom();
                    }}
                  />
                </div>
                <Button onClick={addCustom} disabled={atCap || !title.trim()}>
                  Add
                </Button>
              </div>
              {atCap && (
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  A resume can have at most {MAX_RESUME_CUSTOM_SECTIONS} custom sections.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
