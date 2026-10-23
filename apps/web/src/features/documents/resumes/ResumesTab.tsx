'use client';

import type { ResumeSource, ResumeSummary } from '@tailorit/shared/resume';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { PlusIcon, StarIcon, UploadSimpleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import {
  ActionMenu,
  DocumentCard,
  DocumentCollection,
  NewTile,
  matchesQuery,
  type DocumentColumn,
} from '../core';
import { NEW_RESUME_HREF, bulkDeleteResumes, fetchResumes, fetchTemplates, resumeEditorHref, resumeKeys } from '../../resume-editor/api';
import { dropResumesFromList, invalidateResumes, putResumeInList } from '../../resume-editor/cache';
import { ImportTaskNotices, type ImportTask } from './ImportTaskNotices';
import {
  RESUME_SOURCE_LABEL,
  RESUME_SOURCES_SHOWN,
  bulkDeleteNote,
  bulkDeleteResult,
  cardMeta,
  editedShort,
  editedText,
  emptySourceCopy,
  fileBadge,
  filterBySource,
  searchFieldsOf,
  sortResumes,
  templateNameOf,
} from './list';
import { ResumeThumb } from './ResumeThumb';
import { UploadResumeDialog, type UploadedResume } from './UploadResumeDialog';
import { openResumeFile, useResumeActions } from './useResumeActions';

const NOUN = { one: 'resume', many: 'resumes' };

/**
 * Documents › Resumes: free_tailor's two views of a person's resumes in Simplify's look. Grid: a dashed "New resume"
 * tile, then each resume's first page with its label, the ★ Default / Uploaded / PDF badges under it, "Edited … ·
 * {template}" and ⋮. List: rows of Resume | Name on resume | Template | Edited | ⋮ with checkboxes for bulk delete.
 * Search with the "1 of 3 resumes match." line, the All / Created / Uploaded filter and Upload; the view is remembered.
 */
export function ResumesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow();
  const [source, setSource] = useState<ResumeSource>('all');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tasks, setTasks] = useState<ImportTask[]>([]);

  const listQuery = useQuery({ queryKey: resumeKeys.list(), queryFn: ({ signal }) => fetchResumes(signal) });
  const templatesQuery = useQuery({
    queryKey: resumeKeys.templates(),
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 5 * 60_000,
  });
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const all = useMemo(() => sortResumes(listQuery.data ?? []), [listQuery.data]);
  const items = useMemo(() => filterBySource(all, source), [all, source]);
  const templateName = (resume: ResumeSummary) => templateNameOf(resume, templates);
  const searchFields = (resume: ResumeSummary) => searchFieldsOf(resume, templateNameOf(resume, templates));
  const visibleIds = items.filter((item) => matchesQuery(query, searchFields(item))).map((item) => item.id);

  const addTask = (task: ImportTask) => setTasks((current) => [...current.filter((item) => item.taskId !== task.taskId), task]);
  const actions = useResumeActions({ visibleIds, onTaskStarted: addTask });

  const onUploaded = (result: UploadedResume) => {
    putResumeInList(queryClient, result.summary);
    void invalidateResumes(queryClient);
    toast.success('Resume uploaded', result.taskId ? 'An editable copy is being made from it.' : result.label);
    if (result.taskId) addTask({ taskId: result.taskId, label: result.label });
  };

  const uploadButton = (
    <Button variant="outline" icon={<UploadSimpleIcon size={16} />} onClick={() => setUploading(true)}>
      Upload
    </Button>
  );

  const columns: DocumentColumn<ResumeSummary>[] = [
    {
      key: 'resume',
      header: 'Resume',
      track: 'minmax(0,2.2fr)',
      cell: (resume) => <ResumeNameCell resume={resume} />,
    },
    {
      key: 'name',
      header: 'Name on resume',
      track: 'minmax(0,1.4fr)',
      cell: (resume) => <span className="block truncate text-foreground">{resume.nameOnResume || '-'}</span>,
    },
    {
      key: 'template',
      header: 'Template',
      track: 'minmax(0,1.4fr)',
      cell: (resume) => <span className="block truncate text-foreground">{templateName(resume) || '-'}</span>,
    },
    {
      key: 'edited',
      header: 'Edited',
      track: '10rem',
      cell: (resume) => <span className="block truncate text-muted-foreground">{editedShort(resume, now)}</span>,
    },
  ];

  const sourceEmpty = source !== 'all' && all.length > 0 ? emptySourceCopy(source) : null;

  return (
    <>
      <ImportTaskNotices tasks={tasks} onDismiss={(taskId) => setTasks((current) => current.filter((task) => task.taskId !== taskId))} />
      <DocumentCollection<ResumeSummary>
        kind="resume"
        variant="cards"
        noun={NOUN}
        aria-label="Resumes"
        items={items}
        getId={(resume) => resume.id}
        getLabel={(resume) => resume.label}
        searchFields={searchFields}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search resumes"
        views={['grid', 'list']}
        defaultView="grid"
        viewStorageKey="tailorit.documents.resumes.view"
        columns={columns}
        renderActions={(resume) => <ActionMenu items={actions.itemsFor(resume)} label={`Actions for ${resume.label}`} />}
        renderCard={(resume, selection) => {
          const badge = fileBadge(resume);
          return (
            <DocumentCard
              kind="resume"
              id={resume.id}
              label={resume.label}
              href={resume.kind === 'built' ? resumeEditorHref(resume.id) : undefined}
              onOpen={resume.kind === 'uploaded' ? () => openResumeFile(resume.id) : undefined}
              thumb={<ResumeThumb resume={resume} title={`${resume.label} preview`} />}
              badges={
                resume.isDefault || resume.kind === 'uploaded' ? (
                  <>
                    {resume.isDefault && (
                      <Badge tone="primary" icon={<StarIcon size={12} weight="fill" />} data-default-resume>
                        Default
                      </Badge>
                    )}
                    {resume.kind === 'uploaded' && <Badge>Uploaded</Badge>}
                    {resume.kind === 'uploaded' && badge && <Badge>{badge}</Badge>}
                  </>
                ) : undefined
              }
              meta={[cardMeta(editedText(resume, now), templateName(resume))]}
              menuItems={actions.itemsFor(resume)}
              selectable={selection.selectable}
              selected={selection.selected}
              onSelectedChange={selection.onSelectedChange}
            />
          );
        }}
        newTile={<NewTile kind="resume" label="New resume" hint="Start from a template" href={NEW_RESUME_HREF} />}
        selectable
        bulkDeleteNote={(selected) => bulkDeleteNote(selected)}
        onBulkDelete={async (ids) => {
          const result = await bulkDeleteResumes(ids);
          dropResumesFromList(queryClient, ids.filter((id) => !result.skippedIds.includes(id)));
          void invalidateResumes(queryClient);
          toast.success(bulkDeleteResult(result));
        }}
        toolbarExtras={
          <>
            <Select<ResumeSource>
              aria-label="Resume source"
              value={source}
              onValueChange={setSource}
              options={RESUME_SOURCES_SHOWN.map((value) => ({ value, label: RESUME_SOURCE_LABEL[value] }))}
              className="w-36"
            />
            {uploadButton}
          </>
        }
        loading={listQuery.isPending}
        error={
          listQuery.isError ? (
            <Notice
              tone="error"
              title="Could not load your resumes"
              action={
                <Button variant="outline" size="sm" loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>
                  Try again
                </Button>
              }
            >
              {userMessage(listQuery.error, 'Please try again in a moment.')}
            </Notice>
          ) : undefined
        }
        empty={
          sourceEmpty
            ? {
                title: sourceEmpty.title,
                description: sourceEmpty.description,
                action: (
                  <Button variant="outline" onClick={() => setSource('all')}>
                    Show all resumes
                  </Button>
                ),
              }
            : {
                title: 'Create your first resume!',
                description: 'Get started with a polished resume that highlights your skills and experience.',
                action: (
                  <>
                    <Link href={NEW_RESUME_HREF} className={buttonClasses()}>
                      <PlusIcon size={16} weight="bold" />
                      New Resume
                    </Link>
                    {uploadButton}
                  </>
                ),
              }
        }
      />
      {actions.dialogs}
      <UploadResumeDialog open={uploading} onOpenChange={setUploading} onUploaded={onUploaded} />
    </>
  );
}

/** The list's main cell: the label (a link to the editor, or the file for an upload) and its badges. */
function ResumeNameCell({ resume }: { resume: ResumeSummary }) {
  const badge = fileBadge(resume);
  const nameClasses = 'min-w-0 truncate text-left text-sm font-semibold text-foreground hover:underline hover:underline-offset-2';
  return (
    <span className="flex min-w-0 items-center gap-2">
      {resume.kind === 'built' ? (
        <Link href={resumeEditorHref(resume.id)} className={nameClasses} title={resume.label}>
          {resume.label}
        </Link>
      ) : (
        <button type="button" onClick={() => openResumeFile(resume.id)} className={nameClasses} title={resume.label}>
          {resume.label}
        </button>
      )}
      {resume.isDefault && (
        <Badge tone="primary" icon={<StarIcon size={12} weight="fill" />} data-default-resume>
          Default
        </Badge>
      )}
      {resume.kind === 'uploaded' && <Badge>Uploaded</Badge>}
      {badge && <Badge>{badge}</Badge>}
    </span>
  );
}
