'use client';

import type { Editor } from '@tiptap/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findPlaceholders,
  LETTER_EDITOR_PLACEHOLDER,
  LETTER_NAME_TOOLTIP,
  replaceAllPlaceholder,
  validateLetterTitle,
  type CoverLetterDetail,
  type CoverLetterGenerateResult,
  type LetterFontName,
  type PatchCoverLetterBody,
} from '@tailorit/shared/letters';
import { EditorBar } from '@/components/shell/EditorBar';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { DownloadSimpleIcon, FileTextIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { isApiError, userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import {
  createLetter,
  deleteLetter,
  downloadFile,
  fetchLetter,
  importIntoLetter,
  letterExportPath,
  letterKeys,
  patchLetter,
} from '../letter-editor/data';
import { EditorMenu } from '../letter-editor/EditorMenu';
import { isEmptyLetterHtml, isLetterFont, storedHtmlOf, toEditorHtml } from '../letter-editor/html';
import { FileArrowUpIcon, FileDocIcon, FilePdfIcon } from '../letter-editor/icons';
import { LetterEditor } from '../letter-editor/LetterEditor';
import { saveStatusText, useAutosave } from '../letter-editor/useAutosave';
import { GenerateDialog } from './GenerateDialog';
import { PlaceholderBanner, ReplacePlaceholderDialog } from './PlaceholderBanner';

/*
 * The cover letter editor (/cover-letter/[id]): EditorBar (rename, save status, Export Cover Letter, ☰), Simplify's
 * toolbar over the paper, autosave 1 s after typing, the amber "Almost there" banner for {{TAGS}} left in the letter,
 * and "Generate a Tailored Cover Letter" (opens by itself while the letter is empty).
 */

const DOCUMENTS_HREF = '/documents?tab=cover-letters';

/** The tracker's React Query keys all start with 'tracker' (work package T). */
const TRACKER_KEY = ['tracker'] as const;

export function CoverLetterEditorPage({ letterId }: { letterId: string }) {
  const query = useQuery({
    queryKey: letterKeys.detail(letterId),
    queryFn: () => fetchLetter(letterId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: 'always',
  });

  if (query.isPending) {
    return (
      <>
        <EditorBar name="Cover letter" documentsHref={DOCUMENTS_HREF} />
        <PageSpinner label="Opening your cover letter..." />
      </>
    );
  }
  if (query.isError) {
    const missing = isApiError(query.error) && query.error.status === 404;
    return (
      <>
        <EditorBar name="Cover letter" documentsHref={DOCUMENTS_HREF} />
        <main className="flex flex-1 items-start justify-center px-4 py-16">
          <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
            <EmptyState
              icon={<FileTextIcon size={22} />}
              title={missing ? 'This cover letter was not found' : 'This cover letter could not be opened'}
              description={missing ? 'It may have been deleted.' : userMessage(query.error)}
              action={
                <Link href={DOCUMENTS_HREF} className={buttonClasses({ variant: 'outline' })}>
                  Back to Documents
                </Link>
              }
            />
          </div>
        </main>
      </>
    );
  }
  return <LetterWorkspace key={letterId} initial={query.data} />;
}

function LetterWorkspace({ initial }: { initial: CoverLetterDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const id = initial.id;

  const [letter, setLetter] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [font, setFont] = useState<LetterFontName>(isLetterFont(initial.fontFamily) ? initial.fontFamily : 'Times New Roman');
  const [html, setHtml] = useState(initial.contentHtml);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [generateOpen, setGenerateOpen] = useState(() => isEmptyLetterHtml(initial.contentHtml));
  const [generating, setGenerating] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const deleted = useRef(false);

  const remember = useCallback(
    (updated: CoverLetterDetail) => {
      setLetter(updated);
      queryClient.setQueryData(letterKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: letterKeys.all, exact: true });
    },
    [id, queryClient],
  );

  const autosave = useAutosave<PatchCoverLetterBody>(async (patch, { keepalive }) => {
    if (deleted.current) return;
    const updated = await patchLetter(id, patch, { keepalive });
    if (!keepalive) remember(updated);
  });

  const placeholders = useMemo(() => findPlaceholders(html), [html]);

  const setEditorContent = (next: string, emitUpdate: boolean) => {
    editor?.chain().setContent(toEditorHtml(next), { emitUpdate }).run();
    setHtml(next);
  };

  const exportAs = async (format: 'pdf' | 'docx') => {
    setExporting(format);
    try {
      await autosave.flush();
      await downloadFile(letterExportPath(id, format), `${title}.${format}`);
    } catch (error) {
      toast.error('Export failed', userMessage(error, 'The export did not work. Please try again.'));
    } finally {
      setExporting(null);
    }
  };

  const importFile = async (file: File) => {
    try {
      await autosave.flush();
      const updated = await importIntoLetter(id, file);
      setEditorContent(updated.contentHtml, false);
      remember(updated);
      toast.success('Imported', `${file.name} is now the letter's content.`);
    } catch (error) {
      toast.error('Import failed', userMessage(error, 'Could not read file.'));
    }
  };

  const startGenerating = async () => {
    await autosave.flush();
    setGenerating(true);
  };

  const finishGenerating = (result: CoverLetterGenerateResult | null) => {
    setGenerating(false);
    // The request saved the dialog's job fields; a generation also set the origin and the template's font.
    void fetchLetter(id)
      .then((updated) => {
        remember(updated);
        if (result && isLetterFont(updated.fontFamily)) setFont(updated.fontFamily);
      })
      .catch(() => undefined);
    if (!result) return;
    setEditorContent(result.html, false);
    toast.success('Your cover letter is ready', placeholdersSentence(findPlaceholders(result.html)));
  };

  // Ctrl+S: save now (the browser's "save page" would be no use here).
  const { flush } = autosave;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flush().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  return (
    <>
      <EditorBar
        name={title}
        documentsHref={DOCUMENTS_HREF}
        onRename={async (name) => {
          const updated = await patchLetter(id, { title: name });
          setTitle(updated.title);
          remember(updated);
        }}
        validateName={validateLetterTitle}
        maxNameLength={200}
        info={LETTER_NAME_TOOLTIP}
        status={saveStatusText(autosave.state, autosave.savedAt, letter.updatedAt, now)}
        actions={
          <>
            <Button
              icon={<DownloadSimpleIcon size={16} />}
              loading={exporting === 'pdf'}
              onClick={() => void exportAs('pdf')}
              data-export-letter=""
            >
              Export Cover Letter
            </Button>
            <EditorMenu
              items={[
                { key: 'pdf', label: 'Export to PDF', icon: <FilePdfIcon size={16} />, onSelect: () => void exportAs('pdf') },
                { key: 'docx', label: 'Export to Word', icon: <FileDocIcon size={16} />, onSelect: () => void exportAs('docx') },
                {
                  key: 'import',
                  label: 'Import from PDF/DOCX',
                  icon: <FileArrowUpIcon size={16} />,
                  onSelect: () => undefined,
                  onFile: (file) => void importFile(file),
                },
                {
                  key: 'new',
                  label: 'New cover letter',
                  icon: <PlusIcon size={16} />,
                  ruleBefore: true,
                  onSelect: () => router.push('/cover-letter/new'),
                },
                {
                  key: 'delete',
                  label: 'Delete this cover letter',
                  icon: <TrashIcon size={16} />,
                  tone: 'danger',
                  onSelect: () => setConfirmDelete(true),
                },
              ]}
            />
          </>
        }
      />

      <LetterEditor
        initialHtml={initial.contentHtml}
        documentFont={font}
        onDocumentFontChange={(next) => {
          setFont(next);
          autosave.schedule({ fontFamily: next });
        }}
        onChange={(next) => {
          setHtml(next);
          autosave.schedule({ contentHtml: next });
        }}
        editable={!generating}
        placeholder={LETTER_EDITOR_PLACEHOLDER}
        label="Cover letter"
        onGenerate={() => setGenerateOpen(true)}
        onReady={setEditor}
        belowToolbar={
          placeholders.length > 0 ? <PlaceholderBanner names={placeholders} onPick={setReplacing} /> : null
        }
      />

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        letter={letter}
        onStart={startGenerating}
        onDone={finishGenerating}
      />

      <ReplacePlaceholderDialog
        name={replacing}
        onOpenChange={(open) => !open && setReplacing(null)}
        onApply={(name, text) => {
          if (!editor) return;
          const next = replaceAllPlaceholder(storedHtmlOf(editor), name, text);
          // A real edit: the update event saves it.
          editor.chain().focus().setContent(toEditorHtml(next)).run();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Cover Letter"
        description="Are you sure you want to delete this cover letter? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          deleted.current = true;
          try {
            await deleteLetter(id);
          } catch (error) {
            deleted.current = false;
            throw error;
          }
          queryClient.removeQueries({ queryKey: letterKeys.detail(id) });
          await queryClient.invalidateQueries({ queryKey: letterKeys.all, exact: true });
          router.replace(DOCUMENTS_HREF);
        }}
      />
    </>
  );
}

function placeholdersSentence(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  return names.length === 1
    ? 'Fill in the one highlighted tag to finish it.'
    : `Fill in the ${names.length} highlighted tags to finish it.`;
}

/**
 * /cover-letter/new: creates "Cover Letter {M/D/YYYY}" (prefilled from a tracked application or a job when given)
 * and opens it; the generate dialog then opens by itself because the letter is empty.
 */
export function NewCoverLetterPage({
  applicationId,
  jobId,
  templateId,
}: {
  applicationId?: string;
  jobId?: number;
  templateId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    setError(null);
    createLetter({ applicationId, jobId, templateId })
      .then((letter) => {
        queryClient.setQueryData(letterKeys.detail(letter.id), letter);
        void queryClient.invalidateQueries({ queryKey: letterKeys.all, exact: true });
        // Started from a tracked application, the letter became its cover letter on the server: the tracker reads it
        // again instead of showing the application without it.
        if (letter.applicationId) void queryClient.invalidateQueries({ queryKey: TRACKER_KEY });
        router.replace(`/cover-letter/${letter.id}`);
      })
      .catch((caught: unknown) => setError(userMessage(caught, 'The cover letter could not be created. Please try again.')));
  }, [applicationId, jobId, templateId, queryClient, router]);

  useEffect(() => {
    // Once per visit (React's development double effects must not make two letters).
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);

  return (
    <>
      <EditorBar name="New cover letter" documentsHref={DOCUMENTS_HREF} />
      {error ? (
        <main className="flex flex-1 items-start justify-center px-4 py-16">
          <Notice
            tone="error"
            title="We could not start a new cover letter"
            className="w-full max-w-lg"
            action={
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={create}>
                  Try again
                </Button>
                <Link href={DOCUMENTS_HREF} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                  Back to Documents
                </Link>
              </span>
            }
          >
            {error}
          </Notice>
        </main>
      ) : (
        <PageSpinner label="Creating your cover letter..." />
      )}
    </>
  );
}
