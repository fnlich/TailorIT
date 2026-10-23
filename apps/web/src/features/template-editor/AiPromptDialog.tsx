'use client';

import { useState, type FormEvent } from 'react';
import { AI_PROMPT_HINT, AI_PROMPT_MAX } from '@tailorit/shared/letters';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { userMessage } from '@/lib/api';

/** "✨ AI Prompt": extra context for generating a letter from this template (at most 1,000 characters, counted). */
export function AiPromptDialog({
  open,
  onOpenChange,
  value,
  readOnly,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  readOnly?: boolean;
  onSave: (prompt: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PromptForm value={value} readOnly={readOnly} onSave={onSave} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function PromptForm({
  value,
  readOnly,
  onSave,
  onClose,
}: {
  value: string;
  readOnly?: boolean;
  onSave: (prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = text.length > AI_PROMPT_MAX;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
      onClose();
    } catch (caught) {
      setError(userMessage(caught, 'The prompt could not be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="AI Prompt" description={AI_PROMPT_HINT} size="lg">
      <form onSubmit={(event) => void submit(event)} className="mt-5 flex flex-col gap-2">
        <Textarea
          aria-label="AI prompt"
          value={text}
          rows={8}
          autoFocus
          readOnly={readOnly}
          maxLength={AI_PROMPT_MAX}
          placeholder="For example: Keep the tone warm and mention a specific project from my resume."
          onChange={(event) => setText(event.target.value)}
        />
        <p className={tooLong ? 'text-right text-xs text-[#c62a29]' : 'text-right text-xs text-muted-foreground'} aria-live="polite">
          {text.length}/{AI_PROMPT_MAX}
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter flush className="pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" loading={busy} disabled={tooLong}>
              Save
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
