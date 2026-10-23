'use client';

import type { Editor } from '@tiptap/core';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

/** "example.com" -> "https://example.com", "me@x.com" -> "mailto:me@x.com"; schemes other than http(s)/mailto/tel are refused. */
export function normalizeLink(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(text)) return text;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  if (/^[^\s]+\.[^\s]{2,}/.test(text)) return `https://${text}`;
  return null;
}

/** Add, change or remove the link at the selection (Ctrl+K). */
export function LinkDialog({ editor, open, onOpenChange }: { editor: Editor | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && editor && <LinkForm editor={editor} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? '';
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const href = normalizeLink(value);
    if (!href) {
      setError('Enter a web address, such as https://example.com, or an email address.');
      return;
    }
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive('link')) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  };

  return (
    <DialogContent title={current ? 'Edit link' : 'Add link'} size="md">
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <Field label="Link" error={error}>
          <Input
            value={value}
            autoFocus
            placeholder="https://example.com"
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <DialogFooter flush className="pt-2">
          {current && (
            <Button variant="ghost" className="mr-auto" onClick={remove}>
              Remove link
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Apply</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
