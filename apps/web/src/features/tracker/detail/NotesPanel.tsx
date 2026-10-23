'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ApplicationDetail } from '@tailorit/shared';
import { trackerApi, trackerKeys } from '../data';
import { RichTextEditor } from '../RichTextEditor';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save. Keep typing to retry.",
};

/**
 * "Notes": rich text that saves itself 500 ms after typing stops, and once more when the sheet closes with text still
 * unsaved. Saves run one after another, so an older one never lands after a newer one, and text is only considered
 * saved once the server has it.
 */
export function NotesPanel({ application }: { application: ApplicationDetail }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  /** The latest text not yet saved, or null. */
  const pending = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const id = application.id;

  const save = useRef((html: string) => {
    queue.current = queue.current.then(async () => {
      setState('saving');
      try {
        const saved = await trackerApi.patch(id, { notesHtml: html });
        client.setQueryData<ApplicationDetail>(trackerKeys.detail(id), (detail) =>
          detail ? { ...detail, notesHtml: saved.notesHtml, updatedAt: saved.updatedAt } : detail,
        );
        if (pending.current === html) pending.current = null;
        setState(pending.current === null ? 'saved' : 'saving');
      } catch {
        setState('error');
      }
    });
  });

  useEffect(() => {
    if (draft === null) return;
    pending.current = draft;
    const timer = window.setTimeout(() => save.current(draft), 500);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // Closing within the 500 ms (or after a failed save) still keeps what was typed.
  useEffect(
    () => () => {
      if (pending.current !== null) save.current(pending.current);
    },
    [],
  );

  return (
    <section aria-labelledby="notes-heading" className="rounded-surface border border-border bg-surface p-5 shadow-soft">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 id="notes-heading" className="text-base font-semibold text-foreground">
          Notes
        </h3>
        <span role="status" className="text-xs text-muted-foreground">
          {SAVE_LABEL[state]}
        </span>
      </header>
      <RichTextEditor
        value={application.notesHtml}
        onChange={setDraft}
        placeholder="Add notes, reminders, or contacts for this job"
        label="Notes"
        minHeight={150}
      />
    </section>
  );
}
