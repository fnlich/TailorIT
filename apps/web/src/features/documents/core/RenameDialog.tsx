'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { userMessage } from '@/lib/api';

export interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Change resume name" */
  title: string;
  description?: string;
  /** The field's label (default "Name"). */
  label?: string;
  initialValue: string;
  /** Return a sentence to refuse a name ("Template name must be at least 3 characters long"). */
  validate?: (name: string) => string | null;
  maxLength?: number;
  /** Resolve to close; reject to stay open with the error's sentence. Called with the trimmed name. */
  onSubmit: (name: string) => Promise<void> | void;
  keepLabel?: string;
  changeLabel?: string;
}

/** Simplify's rename modal ("Change resume name" with "Keep it" / "Change"). */
export function RenameDialog(props: RenameDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Keyed by the open state so each opening starts from the current name. */}
      {props.open && <RenameForm key={props.initialValue} {...props} />}
    </Dialog>
  );
}

function RenameForm({
  onOpenChange,
  title,
  description,
  label = 'Name',
  initialValue,
  validate,
  maxLength = 120,
  onSubmit,
  keepLabel = 'Keep it',
  changeLabel = 'Change',
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = value.trim();
    const problem = validate?.(name) ?? (name ? null : 'Enter a name.');
    if (problem) {
      setFieldError(problem);
      return;
    }
    if (name === initialValue.trim()) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onOpenChange(false);
    } catch (caught) {
      setError(userMessage(caught, 'Could not rename it. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={title} description={description} size="md">
      <form onSubmit={(event) => void submit(event)} className="mt-5 flex flex-col gap-4">
        <Field label={label} error={fieldError}>
          <Input
            value={value}
            maxLength={maxLength}
            autoFocus
            disabled={busy}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setValue(event.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter flush className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {keepLabel}
          </Button>
          <Button type="submit" loading={busy}>
            {changeLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
