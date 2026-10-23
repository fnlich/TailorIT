'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LETTER_ORIGIN_BADGE, validateLetterTitle, type CoverLetterSummary } from '@tailorit/shared/letters';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DownloadSimpleIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { editedLine, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import {
  bulkDeleteLetters,
  deleteLetter,
  downloadFile,
  fetchLetterPreview,
  fetchLetters,
  letterExportPath,
  letterKeys,
  patchLetter,
  uploadLetter,
} from '../../letter-editor/data';
import { EyeIcon } from '../../letter-editor/icons';
import { PreviewDialog } from '../../letter-editor/PreviewDialog';
import { UploadButton } from '../../letter-editor/UploadButton';
import {
  DocumentCard,
  DocumentCollection,
  DocumentNameCell,
  DocumentThumb,
  forgetThumbs,
  NewTile,
  PAGE_LETTER,
  RenameDialog,
  TableRowActions,
  TextCell,
  thumbKey,
  type ActionMenuItem,
  type DocumentColumn,
} from '../core';

/*
 * Documents › Cover Letters: Simplify's table (screenshot 4: Name + Generated / Uploaded badge, Created, Last Edited,
 * ✎ Edit + More ⌄; "{n} selected" with bulk Delete, Upload, Search) plus a thumbnail grid of each letter's first page
 * (US Letter), with a Grid | List toggle remembered in this browser.
 */

const NOUN = { one: 'cover letter', many: 'cover letters' };

function originBadge(letter: CoverLetterSummary, tone: 'outline' | 'dark' = 'outline') {
  const label = LETTER_ORIGIN_BADGE[letter.origin];
  return label ? <Badge tone={tone}>{label}</Badge> : null;
}

export function CoverLettersTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const query = useQuery({ queryKey: letterKeys.all, queryFn: fetchLetters });
  const letters = query.data?.items ?? [];

  const [viewing, setViewing] = useState<CoverLetterSummary | null>(null);
  const [renaming, setRenaming] = useState<CoverLetterSummary | null>(null);
  const [deleting, setDeleting] = useState<CoverLetterSummary | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: letterKeys.all });

  const download = async (letter: CoverLetterSummary, format: 'pdf' | 'docx') => {
    try {
      await downloadFile(letterExportPath(letter.id, format), `${letter.title}.${format}`);
    } catch (error) {
      toast.error('Download failed', userMessage(error, 'The download did not work. Please try again.'));
    }
  };

  const menu = (letter: CoverLetterSummary): ActionMenuItem[] => [
    { key: 'view', label: 'View', icon: <EyeIcon size={16} />, onSelect: () => setViewing(letter) },
    { key: 'rename', label: 'Rename', icon: <PencilSimpleIcon size={16} />, onSelect: () => setRenaming(letter) },
    { key: 'pdf', label: 'Download PDF', icon: <DownloadSimpleIcon size={16} />, onSelect: () => void download(letter, 'pdf') },
    { key: 'docx', label: 'Download Word', icon: <DownloadSimpleIcon size={16} />, onSelect: () => void download(letter, 'docx') },
    { key: 'delete', label: 'Delete', icon: <TrashIcon size={16} />, tone: 'danger', ruleBefore: true, onSelect: () => setDeleting(letter) },
  ];

  const columns: DocumentColumn<CoverLetterSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      track: 'minmax(0,1.06fr)',
      cell: (letter) => (
        <DocumentNameCell name={letter.title} href={`/cover-letter/${letter.id}`} badges={originBadge(letter)} />
      ),
    },
    {
      key: 'created',
      header: 'Created',
      track: 'minmax(0,1fr)',
      cell: (letter) => <TextCell>{relativeTime(letter.createdAt, now)}</TextCell>,
    },
    {
      key: 'edited',
      header: 'Last Edited',
      track: 'minmax(0,0.97fr)',
      cell: (letter) => <TextCell>{relativeTime(letter.lastEditedAt, now)}</TextCell>,
    },
  ];

  const jobLine = (letter: CoverLetterSummary) =>
    [letter.companyName, letter.jobTitle].filter((part) => part.trim()).join(' · ') || 'No job details yet';

  return (
    <>
      <DocumentCollection<CoverLetterSummary>
        kind="cover-letter"
        noun={NOUN}
        items={letters}
        getId={(letter) => letter.id}
        getLabel={(letter) => letter.title}
        searchFields={(letter) => [letter.title, letter.companyName, letter.jobTitle]}
        views={['list', 'grid']}
        defaultView="list"
        viewStorageKey="tailorit.documents.coverLetters.view"
        columns={columns}
        renderActions={(letter) => (
          <TableRowActions label={letter.title} editHref={`/cover-letter/${letter.id}`} menuItems={menu(letter)} />
        )}
        renderCard={(letter, selection) => (
          <DocumentCard
            kind="cover-letter"
            id={letter.id}
            label={letter.title}
            href={`/cover-letter/${letter.id}`}
            thumb={
              <DocumentThumb
                cacheKey={thumbKey('cover-letter', letter.id, letter.updatedAt)}
                load={() => fetchLetterPreview(letter.id)}
                title={`${letter.title} preview`}
                page={PAGE_LETTER}
              />
            }
            overlayBadges={originBadge(letter, 'dark')}
            meta={[
              jobLine(letter),
              letter.lastEditedAt ? editedLine(letter.lastEditedAt, now) : `Created ${relativeTime(letter.createdAt, now)}`,
            ]}
            menuItems={menu(letter)}
            selectable={selection.selectable}
            selected={selection.selected}
            onSelectedChange={selection.onSelectedChange}
          />
        )}
        newTile={
          <NewTile kind="cover-letter" label="New cover letter" hint="Create and customize with AI" href="/cover-letter/new" page={PAGE_LETTER} />
        }
        selectable
        onBulkDelete={async (ids) => {
          const { deleted } = await bulkDeleteLetters(ids);
          for (const id of ids) forgetThumbs(`cover-letter:${id}:`);
          await refresh();
          toast.success(`Deleted ${deleted} ${deleted === 1 ? 'cover letter' : 'cover letters'}`);
        }}
        toolbarExtras={
          <UploadButton
            upload={uploadLetter}
            onUploaded={(letter) => {
              void refresh();
              router.push(`/cover-letter/${letter.id}`);
            }}
          />
        }
        loading={query.isPending}
        error={query.isError ? userMessage(query.error, 'Your cover letters could not be loaded. Please reload the page.') : undefined}
        empty={{
          title: 'Create your first cover letter!',
          description: 'Get started with a personalized cover letter that highlights your qualifications.',
          action: (
            <Link href="/cover-letter/new" className={buttonClasses()}>
              <PlusIcon size={16} />
              New Cover Letter
            </Link>
          ),
        }}
      />

      <PreviewDialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        queryKey={letterKeys.detail(viewing?.id ?? '')}
        load={() => fetchLetterPreview(viewing!.id)}
      />

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Change cover letter name"
        initialValue={renaming?.title ?? ''}
        validate={validateLetterTitle}
        maxLength={200}
        onSubmit={async (title) => {
          if (!renaming) return;
          await patchLetter(renaming.id, { title });
          await refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Cover Letter"
        description="Are you sure you want to delete this cover letter? You won't be able to undo this action."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        onConfirm={async () => {
          if (!deleting) return;
          await deleteLetter(deleting.id);
          forgetThumbs(`cover-letter:${deleting.id}:`);
          await refresh();
        }}
      />
    </>
  );
}
