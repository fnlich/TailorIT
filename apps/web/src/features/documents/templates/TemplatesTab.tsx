'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { LetterTemplateSummary } from '@tailorit/shared/letters';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PlusIcon, TrashIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import {
  bulkDeleteTemplates,
  deleteTemplate,
  duplicateTemplate,
  fetchTemplates,
  templateKeys,
  uploadTemplate,
} from '../../letter-editor/data';
import { CopyIcon } from '../../letter-editor/icons';
import { UploadButton } from '../../letter-editor/UploadButton';
import {
  DocumentCollection,
  DocumentNameCell,
  TableRowActions,
  TextCell,
  type ActionMenuItem,
  type DocumentColumn,
} from '../core';

/*
 * Documents › Templates (Simplify, list only): Name + "System Default" badge + an 80-character preview of the body,
 * Created, Last Edited, ✎ Edit + More ⌄ (Duplicate, Delete). TailorIT's starter templates come first; they cannot
 * be selected or deleted, only opened (read-only) and duplicated.
 */

const NOUN = { one: 'template', many: 'templates' };

export function TemplatesTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const query = useQuery({ queryKey: templateKeys.all, queryFn: fetchTemplates });
  const templates = query.data?.items ?? [];
  const [deleting, setDeleting] = useState<LetterTemplateSummary | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: templateKeys.all });

  const duplicate = async (template: LetterTemplateSummary) => {
    try {
      const copy = await duplicateTemplate(template.id);
      await refresh();
      toast.success(`Duplicated as "${copy.name}"`);
    } catch (error) {
      toast.error('Could not duplicate the template', userMessage(error));
    }
  };

  const menu = (template: LetterTemplateSummary): ActionMenuItem[] => [
    { key: 'duplicate', label: 'Duplicate', icon: <CopyIcon size={16} />, onSelect: () => void duplicate(template) },
    {
      key: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={16} />,
      tone: 'danger',
      ruleBefore: true,
      disabled: template.isSystem,
      title: template.isSystem ? 'System templates cannot be deleted. Duplicate one to make your own.' : undefined,
      onSelect: () => setDeleting(template),
    },
  ];

  const columns: DocumentColumn<LetterTemplateSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      track: 'minmax(0,1.06fr)',
      cell: (template) => (
        <DocumentNameCell
          name={template.name}
          href={`/cover-letter-template/${template.id}`}
          badges={template.isSystem ? <Badge>System Default</Badge> : undefined}
          preview={template.preview || undefined}
        />
      ),
    },
    {
      key: 'created',
      header: 'Created',
      track: 'minmax(0,1fr)',
      cell: (template) => <TextCell>{relativeTime(template.createdAt, now)}</TextCell>,
    },
    {
      key: 'edited',
      header: 'Last Edited',
      track: 'minmax(0,0.97fr)',
      cell: (template) => <TextCell>{relativeTime(template.lastEditedAt, now)}</TextCell>,
    },
  ];

  return (
    <>
      <DocumentCollection<LetterTemplateSummary>
        kind="template"
        noun={NOUN}
        items={templates}
        getId={(template) => template.id}
        getLabel={(template) => template.name}
        searchFields={(template) => [template.name]}
        columns={columns}
        renderActions={(template) => (
          <TableRowActions label={template.name} editHref={`/cover-letter-template/${template.id}`} menuItems={menu(template)} />
        )}
        selectable
        isSelectable={(template) => !template.isSystem}
        bulkDeleteNote={(selected) => {
          const system = selected.filter((template) => template.isSystem).length;
          return system ? `${system} system default ${system === 1 ? 'template' : 'templates'} will be skipped` : null;
        }}
        onBulkDelete={async (ids) => {
          const { deleted } = await bulkDeleteTemplates(ids);
          await refresh();
          toast.success(`Deleted ${deleted} ${deleted === 1 ? 'template' : 'templates'}`);
        }}
        toolbarExtras={
          <UploadButton
            upload={uploadTemplate}
            onUploaded={(template) => {
              void refresh();
              router.push(`/cover-letter-template/${template.id}`);
            }}
          />
        }
        loading={query.isPending}
        error={query.isError ? userMessage(query.error, 'Your templates could not be loaded. Please reload the page.') : undefined}
        empty={{
          title: 'Create your first template!',
          description: 'Get started by creating a reusable cover letter template with dynamic placeholders.',
          action: (
            <Link href="/cover-letter-template/new" className={buttonClasses()}>
              <PlusIcon size={16} />
              New Template
            </Link>
          ),
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Template"
        description="Are you sure you want to delete this template? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTemplate(deleting.id);
          await refresh();
        }}
      />
    </>
  );
}
