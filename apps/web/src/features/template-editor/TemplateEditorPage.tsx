'use client';

import type { Editor } from '@tiptap/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TEMPLATE_EDITOR_PLACEHOLDER,
  TEMPLATE_NAME_TOOLTIP,
  validateTemplateName,
  type LetterFontName,
  type LetterTemplateDetail,
  type LetterTemplateSummary,
  type PatchLetterTemplateBody,
} from '@tailorit/shared/letters';
import { EditorBar, EditorBarButton } from '@/components/shell/EditorBar';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { CirclesFourIcon, LockIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { isApiError, userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import {
  createTemplate,
  deleteTemplate,
  downloadFile,
  duplicateTemplate,
  fetchTemplate,
  fetchTemplates,
  importIntoTemplate,
  patchTemplate,
  templateExportPath,
  templateKeys,
} from '../letter-editor/data';
import { EditorMenu } from '../letter-editor/EditorMenu';
import { isEmptyLetterHtml, isLetterFont, storedHtmlOf, toEditorHtml } from '../letter-editor/html';
import { CopyIcon, FileArrowUpIcon, FilePdfIcon, SparkleIcon } from '../letter-editor/icons';
import { LetterEditor } from '../letter-editor/LetterEditor';
import { saveStatusText, useAutosave } from '../letter-editor/useAutosave';
import { AiPromptDialog } from './AiPromptDialog';
import { BaseFromTemplateSelect } from './BaseFromTemplateSelect';
import { InsertVariableSelect } from './InsertVariableSelect';

/*
 * The cover letter template editor (/cover-letter-template/[id], Simplify screenshot 5): EditorBar with rename and
 * ✨ AI Prompt, the toolbar, "Insert variable..." and "Base from template..." under it, and the paper with
 * `{{VARIABLE}}` chips. TailorIT's starter templates open read-only, with "Duplicate to edit".
 */

const DOCUMENTS_HREF = '/documents?tab=templates';

export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const query = useQuery({
    queryKey: templateKeys.detail(templateId),
    queryFn: () => fetchTemplate(templateId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: 'always',
  });

  if (query.isPending) {
    return (
      <>
        <EditorBar name="Template" documentsHref={DOCUMENTS_HREF} />
        <PageSpinner label="Opening your template..." />
      </>
    );
  }
  if (query.isError) {
    const missing = isApiError(query.error) && query.error.status === 404;
    return (
      <>
        <EditorBar name="Template" documentsHref={DOCUMENTS_HREF} />
        <main className="flex flex-1 items-start justify-center px-4 py-16">
          <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
            <EmptyState
              icon={<CirclesFourIcon size={22} />}
              title={missing ? 'This template was not found' : 'This template could not be opened'}
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
  return <TemplateWorkspace key={templateId} initial={query.data} />;
}

function TemplateWorkspace({ initial }: { initial: LetterTemplateDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const id = initial.id;
  const readOnly = initial.isSystem;

  const [template, setTemplate] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [font, setFont] = useState<LetterFontName>(isLetterFont(initial.fontFamily) ? initial.fontFamily : 'Times New Roman');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [basing, setBasing] = useState<LetterTemplateSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const deleted = useRef(false);

  const others = useQuery({ queryKey: templateKeys.all, queryFn: fetchTemplates });
  const otherTemplates = (others.data?.items ?? []).filter((item) => item.id !== id);

  const remember = useCallback(
    (updated: LetterTemplateDetail) => {
      setTemplate(updated);
      queryClient.setQueryData(templateKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: templateKeys.all, exact: true });
    },
    [id, queryClient],
  );

  const autosave = useAutosave<PatchLetterTemplateBody>(async (patch, { keepalive }) => {
    if (deleted.current || readOnly) return;
    const updated = await patchTemplate(id, patch, { keepalive });
    if (!keepalive) remember(updated);
  });

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

  const duplicateToEdit = async () => {
    setDuplicating(true);
    try {
      const copy = await duplicateTemplate(id);
      queryClient.setQueryData(templateKeys.detail(copy.id), copy);
      void queryClient.invalidateQueries({ queryKey: templateKeys.all, exact: true });
      router.push(`/cover-letter-template/${copy.id}`);
    } catch (error) {
      toast.error('Could not duplicate the template', userMessage(error));
      setDuplicating(false);
    }
  };

  const exportPdf = async () => {
    try {
      await flush();
      await downloadFile(templateExportPath(id, 'pdf'), `${name}.pdf`);
    } catch (error) {
      toast.error('Export failed', userMessage(error, 'The export did not work. Please try again.'));
    }
  };

  const importFile = async (file: File) => {
    try {
      await flush();
      const updated = await importIntoTemplate(id, file);
      editor?.chain().setContent(toEditorHtml(updated.contentHtml), { emitUpdate: false }).run();
      remember(updated);
      toast.success('Imported', `${file.name} is now the template's content.`);
    } catch (error) {
      toast.error('Import failed', userMessage(error, 'Could not read file.'));
    }
  };

  /** Copies another template's content in (the update event saves it). */
  const baseOn = async (source: LetterTemplateSummary) => {
    try {
      const detail = await fetchTemplate(source.id);
      editor?.chain().focus().setContent(toEditorHtml(detail.contentHtml)).run();
      toast.success(`Started from "${detail.name}"`);
    } catch (error) {
      toast.error('Could not copy that template', userMessage(error));
    }
  };

  const menuItems = readOnly
    ? [
        { key: 'pdf', label: 'Export to PDF', icon: <FilePdfIcon size={16} />, onSelect: () => void exportPdf() },
        {
          key: 'duplicate',
          label: 'Duplicate to edit',
          icon: <CopyIcon size={16} />,
          onSelect: () => void duplicateToEdit(),
        },
        {
          key: 'new',
          label: 'New template',
          icon: <PlusIcon size={16} />,
          ruleBefore: true,
          onSelect: () => router.push('/cover-letter-template/new'),
        },
      ]
    : [
        { key: 'pdf', label: 'Export to PDF', icon: <FilePdfIcon size={16} />, onSelect: () => void exportPdf() },
        {
          key: 'import',
          label: 'Import from PDF/DOCX',
          icon: <FileArrowUpIcon size={16} />,
          onSelect: () => undefined,
          onFile: (file: File) => void importFile(file),
        },
        {
          key: 'new',
          label: 'New template',
          icon: <PlusIcon size={16} />,
          ruleBefore: true,
          onSelect: () => router.push('/cover-letter-template/new'),
        },
        {
          key: 'delete',
          label: 'Delete this template',
          icon: <TrashIcon size={16} />,
          tone: 'danger' as const,
          onSelect: () => setConfirmDelete(true),
        },
      ];

  return (
    <>
      <EditorBar
        name={name}
        documentsHref={DOCUMENTS_HREF}
        onRename={
          readOnly
            ? undefined
            : async (next) => {
                const updated = await patchTemplate(id, { name: next });
                setName(updated.name);
                remember(updated);
              }
        }
        validateName={validateTemplateName}
        maxNameLength={200}
        info={TEMPLATE_NAME_TOOLTIP}
        status={readOnly ? 'Read-only' : saveStatusText(autosave.state, autosave.savedAt, template.updatedAt, now)}
        actions={
          <>
            {readOnly ? (
              <EditorBarButton
                label="Duplicate to edit"
                shortLabel="Duplicate"
                icon={<CopyIcon size={16} />}
                loading={duplicating}
                onClick={() => void duplicateToEdit()}
                data-duplicate-template=""
              />
            ) : null}
            <EditorBarButton
              label="AI Prompt"
              variant="outline"
              icon={<SparkleIcon size={16} weight="fill" className="text-primary-ink" />}
              onClick={() => setPromptOpen(true)}
              data-ai-prompt=""
            />
            <EditorMenu items={menuItems} />
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
        onChange={(html) => autosave.schedule({ contentHtml: html })}
        editable={!readOnly}
        placeholder={TEMPLATE_EDITOR_PLACEHOLDER}
        label="Template"
        onReady={setEditor}
        belowToolbar={
          <div className="flex flex-col gap-3">
            {readOnly && (
              <Notice
                tone="info"
                title="This is a TailorIT starter template"
                action={
                  <Button size="sm" icon={<CopyIcon size={14} />} loading={duplicating} onClick={() => void duplicateToEdit()}>
                    Duplicate to edit
                  </Button>
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <LockIcon size={14} /> Starter templates are read-only. Duplicate it to make your own copy you can change.
                </span>
              </Notice>
            )}
            {!readOnly && (
              <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                <InsertVariableSelect
                  disabled={!editor}
                  onInsert={(variable) => editor?.chain().focus().insertVariable(variable).run()}
                />
                <BaseFromTemplateSelect
                  templates={otherTemplates}
                  disabled={!editor}
                  onPick={(source) => {
                    if (!editor) return;
                    if (isEmptyLetterHtml(storedHtmlOf(editor))) void baseOn(source);
                    else setBasing(source);
                  }}
                />
              </div>
            )}
          </div>
        }
      />

      <AiPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        value={template.aiPrompt}
        readOnly={readOnly}
        onSave={async (prompt) => {
          await flush();
          remember(await patchTemplate(id, { aiPrompt: prompt }));
        }}
      />

      <ConfirmDialog
        open={basing !== null}
        onOpenChange={(open) => !open && setBasing(null)}
        title="Replace this template's content?"
        description={`The editor's content will be replaced with a copy of "${basing?.name ?? ''}".`}
        confirmLabel="Replace"
        tone="primary"
        onConfirm={async () => {
          if (basing) await baseOn(basing);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Template"
        description="Are you sure you want to delete this template? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          deleted.current = true;
          try {
            await deleteTemplate(id);
          } catch (error) {
            deleted.current = false;
            throw error;
          }
          queryClient.removeQueries({ queryKey: templateKeys.detail(id) });
          await queryClient.invalidateQueries({ queryKey: templateKeys.all, exact: true });
          router.replace(DOCUMENTS_HREF);
        }}
      />
    </>
  );
}

/** /cover-letter-template/new: creates "Template {date, time}" and opens it. */
export function NewTemplatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    setError(null);
    createTemplate()
      .then((template) => {
        queryClient.setQueryData(templateKeys.detail(template.id), template);
        void queryClient.invalidateQueries({ queryKey: templateKeys.all, exact: true });
        router.replace(`/cover-letter-template/${template.id}`);
      })
      .catch((caught: unknown) => setError(userMessage(caught, 'The template could not be created. Please try again.')));
  }, [queryClient, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);

  return (
    <>
      <EditorBar name="New template" documentsHref={DOCUMENTS_HREF} />
      {error ? (
        <main className="flex flex-1 items-start justify-center px-4 py-16">
          <Notice
            tone="error"
            title="We could not start a new template"
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
        <PageSpinner label="Creating your template..." />
      )}
    </>
  );
}
