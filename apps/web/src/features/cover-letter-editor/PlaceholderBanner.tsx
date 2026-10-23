'use client';

import { useState, type FormEvent } from 'react';
import {
  PLACEHOLDER_BANNER_TEXT,
  PLACEHOLDER_BANNER_TITLE,
  REPLACE_PLACEHOLDER_TITLE,
  replacePlaceholderHint,
  variableDefinition,
} from '@tailorit/shared/letters';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { WarningCircleIcon } from '@/components/ui/icons';
import { Textarea } from '@/components/ui/Input';

/**
 * Simplify's amber "Almost there" banner over the paper: one chip per `{{TAG}}` still in the letter; a chip opens
 * "Replace placeholder", which replaces every copy of that tag.
 */
export function PlaceholderBanner({ names, onPick }: { names: readonly string[]; onPick: (name: string) => void }) {
  if (names.length === 0) return null;
  return (
    <section
      aria-label="Unfilled placeholders"
      data-placeholder-banner=""
      className="flex items-start gap-3 rounded-[12px] border border-[#f1e6c4] bg-amber px-4 py-3.5 text-amber-foreground"
    >
      <WarningCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 font-semibold">{PLACEHOLDER_BANNER_TITLE}</p>
        <p className="text-[13px] leading-5">{PLACEHOLDER_BANNER_TEXT}</p>
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onPick(name)}
                title={variableDefinition(name)?.description}
                className="rounded-[4px] bg-sky px-1.5 py-px text-[13px] font-medium text-sky-foreground ring-1 ring-[#cfe7f8] transition-colors hover:bg-[#d9eefc] focus-visible:outline-offset-1"
              >
                {`{{${name}}}`}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ReplacePlaceholderDialog({
  name,
  onOpenChange,
  onApply,
}: {
  name: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: (name: string, text: string) => void;
}) {
  return (
    <Dialog open={name !== null} onOpenChange={onOpenChange}>
      {name !== null && <ReplaceForm key={name} name={name} onClose={() => onOpenChange(false)} onApply={onApply} />}
    </Dialog>
  );
}

function ReplaceForm({ name, onClose, onApply }: { name: string; onClose: () => void; onApply: (name: string, text: string) => void }) {
  const [text, setText] = useState('');
  const definition = variableDefinition(name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onApply(name, text);
    onClose();
  };
  return (
    <DialogContent title={REPLACE_PLACEHOLDER_TITLE} description={replacePlaceholderHint(name)} size="md">
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <Field label={definition?.label ?? name} hint={definition?.description}>
          <Textarea
            value={text}
            autoFocus
            autoGrow
            rows={2}
            placeholder={`Text for {{${name}}}`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </Field>
        <DialogFooter flush className="pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!text.trim()}>
            Apply
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
