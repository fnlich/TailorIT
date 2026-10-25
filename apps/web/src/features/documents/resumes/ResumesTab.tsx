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
import { Spinner } from '@/components/ui/Spinner';
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
import { createPollClock } from '../../resume-editor/analysis';
import { NEW_RESUME_HREF, bulkDeleteResumes, fetchResumes, fetchTemplates, resumeEditorHref, resumeKeys } from '../../resume-editor/api';
import { dropResumesFromList, invalidateResumes, putResumeInList } from '../../resume-editor/cache';
import { EditableCopiesNotices } from './EditableCopiesNotices';
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
  profileLine,
  readingsPending,
  searchFieldsOf,
  sortResumes,
  templateNameOf,
  uploadsFinishedToast,
} from './list';
import { ResumeThumb } from './ResumeThumb';
import { UploadResumeDialog, type RunOutcome, type UploadedResume } from './UploadResumeDialog';
import { openResumeFile, resumeDetailsHref, useResumeActions } from './useResumeActions';

const NOUN = { one: 'resume', many: 'resumes' };

/**
 * Documents › Resumes: free_tailor's two views of a person's resumes in Simplify's look. Grid: a dashed "New resume"
 * tile, then each resume's first page with its label, the ★ Default / Uploaded / PDF badges under it, "Edited … ·
 * {template}", what TailorIT read from it ("8 yrs · React, TypeScript, Node.js +9") and ⋮. List: rows of Resume (the
 * label, its badges and the same reading under it) | Name on resume | Template | Edited | ⋮ with checkboxes for bulk
 * delete. Search (labels, names, templates and main skills) with the "1 of 3 resumes match." line, the All / Created /
 * Uploaded filter and Upload (one file or many); the view is remembered. While a reading is still to come the list is
 * read again, less and less often, for up to ten minutes.
 */
export function ResumesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow();
  const [source, setSource] = useState<ResumeSource>('all');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [readingPoll] = useState(createPollClock);

  const listQuery = useQuery({
    queryKey: resumeKeys.list(),
    queryFn: ({ signal }) => fetchResumes(signal),
    refetchInterval: (current) => readingPoll.next(readingsPending(current.state.data), Date.now()),
  });
  const templatesQuery = useQuery({
    queryKey: resumeKeys.templates(),
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 5 * 60_000,
  });
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const all = useMemo(() => sortResumes(listQuery.data ?? []), [listQuery.data]);
  const items = useMemo(() => filterBySource(all, source), [all, source]);
  const templateName = (resume: ResumeSummary) => templateNameOf(resume, templates);
  const searchFields = (resume: ResumeSummary) =>
    searchFieldsOf(resume, templateNameOf(resume, templates), resume.analysis?.hardSkills);
  const visibleIds = items.filter((item) => matchesQuery(query, searchFields(item))).map((item) => item.id);

  const addTask = (task: ImportTask) => setTasks((current) => [...current.filter((item) => item.key !== task.key), task]);
  const actions = useResumeActions({
    visibleIds,
    onTaskStarted: ({ taskId, label }) => addTask({ key: taskId, taskId, label }),
  });

  // Each stored upload shows at once. One file's editable copy that started is followed here, one that could not start
  // is said, and the upload stays either way; the copies of several files carry no task (EditableCopiesNotices
  // follows them).
  const onUploaded = (result: UploadedResume) => {
    putResumeInList(queryClient, result.summary);
    if (result.taskId) addTask({ key: result.taskId, taskId: result.taskId, label: result.label });
    else if (result.copyError) {
      addTask({ key: `copy:${result.id ?? result.label}`, taskId: null, label: result.label, error: result.copyError });
    }
  };

  // The end of an upload run: the list is read once (with what TailorIT read from each), and the copies of several
  // files with it; one toast sums it up.
  const onUploadsFinished = (outcome: RunOutcome) => {
    readingPoll.reset();
    void invalidateResumes(queryClient);
    const summary = uploadsFinishedToast(outcome);
    if (summary) toast.success(summary.title, summary.description);
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
      <EditableCopiesNotices />
      <ImportTaskNotices tasks={tasks} onDismiss={(key) => setTasks((current) => current.filter((task) => task.key !== key))} />
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
              meta={[cardMeta(editedText(resume, now), templateName(resume)), <ProfileLine key="profile" resume={resume} />]}
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
      <UploadResumeDialog open={uploading} onOpenChange={setUploading} onUploaded={onUploaded} onFinished={onUploadsFinished} />
    </>
  );
}

/**
 * What TailorIT read from a resume, on one line: "8 yrs · React, TypeScript, Node.js +9" (a small spinner first while
 * the AI reads it), "Finding skills...", "Waiting for the AI reading" or "No skills found". An upload's line opens its
 * page at that reading. Nothing known yet: an empty line that keeps its place.
 */
function ProfileLine({ resume }: { resume: ResumeSummary }) {
  const line = profileLine(resume.analysis);
  if (!line.text) {
    return (
      <span aria-hidden="true" data-profile-line="">
        &nbsp;
      </span>
    );
  }
  const content = (
    <>
      {line.refining && (
        <>
          <Spinner size={12} className="mr-1.5 inline-block align-[-1px]" />
          <span className="sr-only">Reading it with AI. </span>
        </>
      )}
      {line.text}
    </>
  );
  if (resume.kind === 'uploaded' && line.hasReading) {
    return (
      <Link
        href={resumeDetailsHref(resume.id)}
        data-profile-line=""
        title={line.text}
        className="hover:text-foreground hover:underline hover:underline-offset-2"
      >
        {content}
      </Link>
    );
  }
  return (
    <span data-profile-line="" title={line.text}>
      {content}
    </span>
  );
}

/** The list's main cell: the label (a link to the editor, or the file for an upload), its badges and its reading. */
function ResumeNameCell({ resume }: { resume: ResumeSummary }) {
  const badge = fileBadge(resume);
  const nameClasses = 'min-w-0 truncate text-left text-sm font-semibold text-foreground hover:underline hover:underline-offset-2';
  return (
    <span className="flex min-w-0 flex-col">
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
      <span className="mt-0.5 block min-h-5 truncate text-[13px] leading-5 text-muted-foreground">
        <ProfileLine resume={resume} />
      </span>
    </span>
  );
}
