'use client';

import { BracketsCurlyIcon } from '@phosphor-icons/react/BracketsCurly';
import { FilePdfIcon } from '@phosphor-icons/react/FilePdf';
import { TEMPLATE_CATEGORY_LABEL } from '@tailorit/shared/resume';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { EditorBar } from '@/components/shell/EditorBar';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Button, buttonClasses } from '@/components/ui/Button';
import { CaretDownIcon, EyeIcon, UploadSimpleIcon } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';
import { PageThumb, ThumbLoading } from '@/features/documents/core';
import { NEW_RESUME_HREF, RESUMES_TAB_HREF, fetchTemplates, resumeEditorHref, resumeKeys, templatePreviewSrc, type TemplateInfo } from '../api';
import { JSON_ACCEPT, PDF_ACCEPT, UPLOAD_MAX_MB, chooseFile } from '../files';
import { TEMPLATE_FILTER_LABEL, startResumeHref, templateFilters, templatesForFilter, type TemplateFilter } from '../gallery';
import { useResumeImport } from '../useResumeImport';
import { TemplateDetailsDialog } from './TemplateDetailsDialog';

/** Blank pages standing in the grid while the list is on its way. */
const LOADING_CARDS = 8;

/**
 * "Start building a resume", the first step of a new resume: filter pills (All Templates, then each category some
 * template is filed under), "Import existing resume", and the templates as pages; a page opens its details, whose "Use
 * this template" starts the editor on it in the layout the details were showing.
 */
export function TemplateChooser() {
  const router = useRouter();
  const templatesQuery = useQuery({
    queryKey: resumeKeys.templates(),
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 5 * 60_000,
  });
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const onImported = useCallback((resumeId: string) => router.push(resumeEditorHref(resumeId)), [router]);
  const importer = useResumeImport(onImported);

  const templates = templatesQuery.data ?? [];
  const filters = templateFilters(templates);
  const shownFilter = filters.includes(filter) ? filter : 'all';
  const shown = templatesForFilter(templates, shownFilter);
  // Derived: a template that leaves the list closes its details.
  const open = openId ? (shown.find((template) => template.id === openId) ?? null) : null;

  const pick = async (kind: 'pdf' | 'json') => {
    const file = await chooseFile(kind === 'pdf' ? PDF_ACCEPT : JSON_ACCEPT);
    if (!file) return;
    if (kind === 'pdf') await importer.importPdf(file);
    else await importer.importJson(file);
  };

  const importLabel =
    importer.phase === 'uploading' || importer.phase === 'reading' || importer.phase === 'opening'
      ? 'Reading your resume...'
      : importer.phase === 'importing'
        ? 'Importing...'
        : 'Import existing resume';

  const use = (template: TemplateInfo, layout: 'categorized' | 'flat') => router.push(startResumeHref(template.id, layout));

  return (
    <>
      <EditorBar name="New resume" documentsHref={RESUMES_TAB_HREF} />
      <main className={clsx('mx-auto w-full max-w-[1320px] pt-10 pb-16', PAGE_GUTTER)}>
        <h1 className="text-2xl leading-10 font-bold tracking-[-0.01em] text-foreground sm:text-3xl">Start building a resume</h1>
        <p className="mt-2 text-base text-muted-foreground">Choose a design you like. You can customize or switch it later.</p>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          {filters.length > 1 ? (
            <SegmentedControl
              aria-label="Show templates"
              items={filters.map((value) => ({ value, label: TEMPLATE_FILTER_LABEL[value] }))}
              value={shownFilter}
              onValueChange={setFilter}
            />
          ) : (
            <span />
          )}
          <Menu>
            <MenuTrigger
              disabled={importer.working}
              render={
                <Button
                  variant="outline"
                  icon={importer.working ? <Spinner size={16} /> : <UploadSimpleIcon size={16} />}
                  trailingIcon={importer.working ? undefined : <CaretDownIcon size={14} />}
                />
              }
            >
              {importLabel}
            </MenuTrigger>
            <MenuContent align="end" width="w-[22rem]">
              <MenuItem
                icon={<FilePdfIcon size={18} />}
                hint={`An AI reads it into a new resume. Up to ${UPLOAD_MAX_MB} MB.`}
                onClick={() => void pick('pdf')}
              >
                Resume PDF
              </MenuItem>
              <MenuItem icon={<BracketsCurlyIcon size={18} />} hint="A resume downloaded from this app, or several." onClick={() => void pick('json')}>
                Resume JSON file
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>

        {(importer.working || importer.error || importer.notice) && (
          <div className="mt-5 flex flex-col gap-3">
            {(importer.phase === 'uploading' || importer.phase === 'reading') && (
              <Notice tone="info" title={importer.progress ?? 'Reading your resume...'}>
                Reading your resume with AI. This can take a minute; its editor opens when it is done.
              </Notice>
            )}
            {importer.error && <Notice tone="error">{importer.error}</Notice>}
            {importer.notice && (
              <Notice
                tone="success"
                action={
                  <Link href={RESUMES_TAB_HREF} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                    See your resumes
                  </Link>
                }
              >
                Imported {importer.notice.imported} {importer.notice.imported === 1 ? 'resume' : 'resumes'} from {importer.notice.fileName}.
              </Notice>
            )}
          </div>
        )}

        {templatesQuery.isError ? (
          <div className="mt-8 flex flex-col items-start gap-3">
            <Notice
              tone="error"
              title="Could not load the templates"
              action={
                <Button variant="outline" size="sm" onClick={() => void templatesQuery.refetch()}>
                  Try again
                </Button>
              }
            >
              {userMessage(templatesQuery.error, 'The template list could not be loaded.')}
            </Notice>
            <StartWithout />
          </div>
        ) : templatesQuery.isSuccess && templates.length === 0 ? (
          <div className="mt-8 rounded-surface border border-dashed border-control-strong px-6 py-12 text-center">
            <p className="text-base font-semibold text-foreground">No template is offered on this installation yet.</p>
            <div className="mt-2">
              <StartWithout />
            </div>
          </div>
        ) : (
          <ul
            aria-busy={templatesQuery.isPending}
            aria-label="Templates"
            className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] sm:gap-x-6 sm:gap-y-10"
          >
            {templatesQuery.isPending
              ? Array.from({ length: LOADING_CARDS }, (_, index) => (
                  <li key={index} aria-hidden="true" className="min-w-0">
                    <div className="overflow-hidden rounded-[14px] border border-border bg-white shadow-soft">
                      <PageThumb title="" placeholder={<ThumbLoading />} />
                    </div>
                    <span className="mt-3 block h-4 w-2/3 animate-pulse rounded bg-black/[0.06]" />
                  </li>
                ))
              : shown.map((template) => <TemplateCard key={template.id} template={template} onOpen={() => setOpenId(template.id)} />)}
          </ul>
        )}
      </main>

      {open && (
        <TemplateDetailsDialog template={open} list={shown} onStep={setOpenId} onClose={() => setOpenId(null)} onUse={use} />
      )}
    </>
  );
}

function TemplateCard({ template, onOpen }: { template: TemplateInfo; onOpen: () => void }) {
  return (
    <li className="min-w-0">
      <div
        className={clsx(
          'group relative overflow-hidden rounded-[14px] border border-border bg-white shadow-soft transition-[transform,box-shadow] duration-150 ease-out-soft',
          'hover:-translate-y-0.5 hover:shadow-popover has-[[data-template-card]:focus-visible]:outline-2 has-[[data-template-card]:focus-visible]:outline-offset-[3px] has-[[data-template-card]:focus-visible]:outline-focus',
        )}
      >
        <PageThumb src={templatePreviewSrc(template.id)} title={`${template.name} preview`} placeholder={<ThumbLoading />} />
        {/* The page under a button the size of it: a frame may not sit inside a button. */}
        <button
          type="button"
          data-template-card={template.id}
          onClick={onOpen}
          aria-label={`${template.name}: see the template`}
          className="absolute inset-0 z-[1] flex items-center justify-center rounded-[inherit] bg-transparent transition-colors duration-150 group-hover:bg-black/[0.03] focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground opacity-0 shadow-popover transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
          >
            <EyeIcon size={16} />
            Preview
          </span>
        </button>
      </div>
      <p className="mt-3 truncate text-[15px] leading-6 font-semibold text-foreground" title={template.name}>
        {template.name}
      </p>
      {template.category && <p className="text-[13px] leading-5 text-muted-foreground">{TEMPLATE_CATEGORY_LABEL[template.category]}</p>}
    </li>
  );
}

/** "Start without a template": drawn with the default one until one is chosen in Customize. */
function StartWithout() {
  return (
    <p className="text-sm text-muted-foreground">
      <Link href={`${NEW_RESUME_HREF}?template=`} className="font-semibold text-primary-ink hover:underline">
        Start without a template
      </Link>{' '}
      - the resume is drawn with the default one until you choose.
    </p>
  );
}
