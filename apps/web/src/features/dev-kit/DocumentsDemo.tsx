'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  CopyIcon,
  DownloadSimpleIcon,
  EyeIcon,
  PencilSimpleIcon,
  StarIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@/components/ui/icons';
import { TabPanel } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { editedLine, relativeTime } from '@/lib/format';
import { DocumentActionCards } from '../documents/DocumentActionCards';
import {
  ActionMenu,
  DocumentCard,
  DocumentCollection,
  DocumentNameCell,
  DocumentThumb,
  NewTile,
  PAGE_A4,
  PAGE_LETTER,
  RenameDialog,
  TableRowActions,
  TextCell,
  thumbKey,
  type ActionMenuItem,
  type DocumentColumn,
} from '../documents/core';
import {
  KIT_LETTERS,
  KIT_NOW,
  KIT_RESUMES,
  fakeFetch,
  kitLetterPage,
  kitResumePage,
  type KitLetter,
  type KitResume,
} from './fixtures';

type Source = 'all' | 'created' | 'uploaded';

/** Simplify screenshot 3, rebuilt from the generic layer with fake resumes (table variant). */
export function DocumentsReplica() {
  const toast = useToast();
  const [tab, setTab] = useState<'resumes' | 'cover-letters' | 'templates'>('resumes');
  const [resumes, setResumes] = useState(KIT_RESUMES);
  const [source, setSource] = useState<Source>('all');
  const [renaming, setRenaming] = useState<KitResume | null>(null);
  const [deleting, setDeleting] = useState<KitResume | null>(null);

  const shown = resumes.filter((r) => source === 'all' || (source === 'uploaded' ? r.kind === 'uploaded' : r.kind === 'built'));

  const menu = (resume: KitResume): ActionMenuItem[] => [
    { key: 'view', label: 'View', icon: <EyeIcon size={16} />, onSelect: () => toast.info(`Opening ${resume.title}`) },
    { key: 'rename', label: 'Rename', icon: <PencilSimpleIcon size={16} />, onSelect: () => setRenaming(resume) },
    { key: 'download', label: 'Download', icon: <DownloadSimpleIcon size={16} />, onSelect: () => toast.success('Download started') },
    {
      key: 'default',
      label: 'Set as default',
      icon: <StarIcon size={16} />,
      disabled: resume.isDefault,
      title: resume.isDefault ? 'Already the default resume.' : undefined,
      onSelect: () => {
        setResumes((current) => current.map((r) => ({ ...r, isDefault: r.id === resume.id })));
        toast.success(`${resume.title} is now your default resume.`);
      },
    },
    { key: 'delete', label: 'Delete', icon: <TrashIcon size={16} />, tone: 'danger', ruleBefore: true, onSelect: () => setDeleting(resume) },
  ];

  const columns: DocumentColumn<KitResume>[] = [
    {
      key: 'name',
      header: 'Name',
      track: 'minmax(0,1.06fr)',
      cell: (r) => (
        <DocumentNameCell
          name={r.title}
          href={r.kind === 'built' ? `/resumes/${r.id}` : undefined}
          badges={
            <>
              {r.isDefault && <Badge tone="primary">Default</Badge>}
              {r.kind === 'uploaded' ? <Badge>Uploaded</Badge> : <Badge>Generated</Badge>}
              {r.format && <Badge>{r.format}</Badge>}
            </>
          }
        />
      ),
    },
    { key: 'created', header: 'Created', track: 'minmax(0,1fr)', cell: (r) => <TextCell>{relativeTime(r.createdAt, KIT_NOW)}</TextCell> },
    {
      key: 'edited',
      header: 'Last Edited',
      track: 'minmax(0,0.97fr)',
      cell: (r) => <TextCell>{relativeTime(r.lastEditedAt, KIT_NOW)}</TextCell>,
    },
  ];

  return (
    <>
      <h1 className="text-2xl leading-10 font-bold tracking-[-0.01em] text-foreground sm:text-3xl">My Documents</h1>
      <p className="mt-2 text-base text-muted-foreground">Manage all of your job search documents here!</p>
      <DocumentActionCards className="mt-8" />
      <UnderlineTabs
        aria-label="Document types"
        items={[
          { value: 'resumes', label: 'Resumes' },
          { value: 'cover-letters', label: 'Cover Letters' },
          { value: 'templates', label: 'Templates' },
        ]}
        value={tab}
        onValueChange={setTab}
        className="mt-8"
      >
        <TabPanel value="resumes" className="mt-8">
          <DocumentCollection<KitResume>
            kind="resume"
            noun={{ one: 'resume', many: 'resumes' }}
            items={shown}
            getId={(r) => r.id}
            getLabel={(r) => r.title}
            columns={columns}
            selectable
            bulkDeleteNote={(selected) =>
              selected.some((r) => r.isDefault) ? '1 default resume will be skipped' : null
            }
            onBulkDelete={async (ids, selected) => {
              await fakeFetch('', 400);
              const doomed = selected.filter((r) => !r.isDefault).map((r) => r.id);
              setResumes((current) => current.filter((r) => !doomed.includes(r.id)));
              toast.success(`Deleted ${doomed.length} ${doomed.length === 1 ? 'resume' : 'resumes'}`);
            }}
            renderActions={(r) => (
              <TableRowActions
                label={r.title}
                editHref={`/resumes/${r.id}`}
                editDisabled={r.kind === 'uploaded'}
                editDisabledReason="Uploaded files can't be edited. Make an editable copy instead."
                menuItems={menu(r)}
              />
            )}
            toolbarExtras={
              <>
                <Button variant="outline" icon={<UploadSimpleIcon size={16} />} onClick={() => toast.info('Upload Resume')}>
                  Upload
                </Button>
                <Select<Source>
                  aria-label="Resume source"
                  value={source}
                  onValueChange={setSource}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'created', label: 'Created' },
                    { value: 'uploaded', label: 'Uploaded' },
                  ]}
                  className="w-32"
                />
              </>
            }
            empty={{
              title: 'Create your first resume!',
              description: 'Get started with a polished resume that highlights your skills and experience.',
            }}
          />
        </TabPanel>
        <TabPanel value="cover-letters" className="mt-8">
          <CoverLettersDemo />
        </TabPanel>
        <TabPanel value="templates" className="mt-8">
          <DocumentCollection<{ id: string; name: string }>
            kind="template"
            noun={{ one: 'template', many: 'templates' }}
            items={[]}
            getId={(t) => t.id}
            getLabel={(t) => t.name}
            columns={[]}
            selectable
            empty={{
              title: 'Create your first template!',
              description: 'Get started by creating a reusable cover letter template with dynamic placeholders.',
            }}
          />
        </TabPanel>
      </UnderlineTabs>

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Change resume name"
        initialValue={renaming?.title ?? ''}
        validate={(name) => (name.length < 3 ? 'A resume name must be at least 3 characters long' : null)}
        onSubmit={async (name) => {
          await fakeFetch('', 300);
          setResumes((current) => current.map((r) => (r.id === renaming?.id ? { ...r, title: name } : r)));
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Resume"
        description="Are you sure you want to delete this resume? You won't be able to undo this action."
        confirmLabel="Delete"
        onConfirm={async () => {
          await fakeFetch('', 300);
          setResumes((current) => current.filter((r) => r.id !== deleting?.id));
        }}
      />
    </>
  );
}

/** Cover letters: Simplify's table plus a thumbnail grid (view remembered in localStorage). */
export function CoverLettersDemo() {
  const toast = useToast();
  const [letters, setLetters] = useState(KIT_LETTERS);
  const menu = (letter: KitLetter): ActionMenuItem[] => [
    { key: 'view', label: 'View', icon: <EyeIcon size={16} />, onSelect: () => toast.info('Cover Letter Preview') },
    { key: 'rename', label: 'Rename', icon: <PencilSimpleIcon size={16} />, onSelect: () => toast.info('Rename') },
    { key: 'pdf', label: 'Download PDF', icon: <DownloadSimpleIcon size={16} />, onSelect: () => toast.success('Download started') },
    {
      key: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={16} />,
      tone: 'danger',
      ruleBefore: true,
      onSelect: () => setLetters((current) => current.filter((l) => l.id !== letter.id)),
    },
  ];
  return (
    <DocumentCollection<KitLetter>
      kind="cover-letter"
      noun={{ one: 'cover letter', many: 'cover letters' }}
      items={letters}
      getId={(l) => l.id}
      getLabel={(l) => l.title}
      searchFields={(l) => [l.title, l.company, l.jobTitle]}
      views={['list', 'grid']}
      viewStorageKey="tailorit.kit.coverLetters.view"
      columns={[
        {
          key: 'name',
          header: 'Name',
          track: 'minmax(0,1.06fr)',
          cell: (l) => (
            <DocumentNameCell
              name={l.title}
              href={`/cover-letter/${l.id}`}
              badges={<Badge>{l.origin === 'generated' ? 'Generated' : 'Uploaded'}</Badge>}
            />
          ),
        },
        { key: 'created', header: 'Created', track: 'minmax(0,1fr)', cell: (l) => <TextCell>{relativeTime(l.createdAt, KIT_NOW)}</TextCell> },
        { key: 'edited', header: 'Last Edited', track: 'minmax(0,0.97fr)', cell: (l) => <TextCell>{relativeTime(l.lastEditedAt, KIT_NOW)}</TextCell> },
      ]}
      renderActions={(l) => <TableRowActions label={l.title} editHref={`/cover-letter/${l.id}`} menuItems={menu(l)} />}
      renderCard={(l, selection) => (
        <DocumentCard
          kind="cover-letter"
          id={l.id}
          label={l.title}
          href={`/cover-letter/${l.id}`}
          thumb={
            <DocumentThumb
              cacheKey={thumbKey('cover-letter', l.id, l.updatedAt)}
              load={() => fakeFetch(kitLetterPage(l))}
              title={`${l.title} preview`}
              page={PAGE_LETTER}
            />
          }
          badges={<Badge>{l.origin === 'generated' ? 'Generated' : 'Uploaded'}</Badge>}
          meta={[`${l.company} · ${l.jobTitle}`, editedLine(l.updatedAt, KIT_NOW)]}
          menuItems={menu(l)}
          selectable={selection.selectable}
          selected={selection.selected}
          onSelectedChange={selection.onSelectedChange}
        />
      )}
      newTile={<NewTile kind="cover-letter" label="New cover letter" hint="Create and customize with AI" href="/cover-letter/new" page={PAGE_LETTER} />}
      selectable
      onBulkDelete={async (ids) => {
        await fakeFetch('', 300);
        setLetters((current) => current.filter((l) => !ids.includes(l.id)));
      }}
      toolbarExtras={
        <Button variant="outline" icon={<UploadSimpleIcon size={16} />}>
          Upload
        </Button>
      }
      empty={{
        title: 'Create your first cover letter!',
        description: 'Get started with a personalized cover letter that highlights your qualifications.',
      }}
    />
  );
}

/** free_tailor's resume views (cards variant): thumbnail grid with the New tile, and the rounded-row list. */
export function ResumeCardsDemo() {
  const toast = useToast();
  const [resumes, setResumes] = useState(KIT_RESUMES);
  const items = (r: KitResume): ActionMenuItem[] => [
    { key: 'edit', label: r.kind === 'uploaded' ? 'View' : 'Edit', icon: <PencilSimpleIcon size={16} />, onSelect: () => toast.info('Edit') },
    { key: 'rename', label: 'Rename', icon: <PencilSimpleIcon size={16} />, onSelect: () => toast.info('Rename') },
    { key: 'duplicate', label: 'Duplicate', icon: <CopyIcon size={16} />, onSelect: () => toast.success(`Duplicated ${r.title}`) },
    { key: 'default', label: 'Set as default', icon: <StarIcon size={16} />, disabled: r.isDefault, onSelect: () => undefined },
    { key: 'pdf', label: 'Download PDF', icon: <DownloadSimpleIcon size={16} />, onSelect: () => undefined },
    { key: 'docx', label: 'Download Word', hint: 'Simple layout', icon: <DownloadSimpleIcon size={16} />, onSelect: () => undefined },
    {
      key: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={16} />,
      tone: 'danger',
      ruleBefore: true,
      onSelect: () => setResumes((current) => current.filter((x) => x.id !== r.id)),
    },
  ];
  return (
    <DocumentCollection<KitResume>
      kind="resume"
      variant="cards"
      noun={{ one: 'resume', many: 'resumes' }}
      items={resumes}
      getId={(r) => r.id}
      getLabel={(r) => r.title}
      searchFields={(r) => [r.title, r.personName, r.template]}
      views={['grid', 'list']}
      viewStorageKey="tailorit.kit.resumes.view"
      columns={[
        {
          key: 'resume',
          header: 'Resume',
          track: 'minmax(0,2.2fr)',
          cell: (r) => (
            <span className="flex min-w-0 items-center gap-2">
              <a href={`/resumes/${r.id}`} className="truncate font-semibold hover:underline">
                {r.title}
              </a>
              {r.isDefault && (
                <Badge tone="tint" icon={<StarIcon size={12} weight="fill" />}>
                  Default
                </Badge>
              )}
              {r.kind === 'uploaded' && <Badge>Uploaded</Badge>}
            </span>
          ),
        },
        { key: 'person', header: 'Name on resume', track: 'minmax(0,1.4fr)', cell: (r) => <span className="truncate">{r.personName}</span> },
        { key: 'template', header: 'Template', track: 'minmax(0,1.4fr)', cell: (r) => r.template || '-' },
        { key: 'edited', header: 'Edited', track: '10rem', cell: (r) => editedLine(r.updatedAt, KIT_NOW) },
      ]}
      renderActions={(r) => <ActionMenu items={items(r)} label={`Actions for ${r.title}`} />}
      renderCard={(r, selection) => (
        <DocumentCard
          kind="resume"
          id={r.id}
          label={r.title}
          href={`/resumes/${r.id}`}
          thumb={
            <DocumentThumb
              cacheKey={thumbKey('resume', r.id, r.updatedAt)}
              load={() => fakeFetch(kitResumePage(r), 500)}
              title={`${r.title} preview`}
              page={PAGE_A4}
            />
          }
          badges={
            r.isDefault ? (
              <Badge tone="tint" icon={<StarIcon size={12} weight="fill" />}>
                Default
              </Badge>
            ) : undefined
          }
          meta={[`${editedLine(r.updatedAt, KIT_NOW)}${r.template ? ` · ${r.template}` : ''}`]}
          menuItems={items(r)}
          selectable={selection.selectable}
          selected={selection.selected}
          onSelectedChange={selection.onSelectedChange}
        />
      )}
      newTile={<NewTile kind="resume" label="New resume" hint="Start from a template" href="/resumes/new" />}
      selectable
      isSelectable={(r) => !r.isDefault}
      bulkDeleteNote={(selected) => (selected.some((r) => r.isDefault) ? '1 default resume will be skipped' : null)}
      onBulkDelete={async (ids) => {
        await fakeFetch('', 300);
        setResumes((current) => current.filter((r) => !ids.includes(r.id)));
      }}
      empty={{ title: 'Create your first resume!', description: 'Get started with a polished resume that highlights your skills and experience.' }}
    />
  );
}
