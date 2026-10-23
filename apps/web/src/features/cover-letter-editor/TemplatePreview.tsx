'use client';

import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useMemo } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { fetchTemplate, templateKeys } from '../letter-editor/data';
import { paperFontStack } from '../letter-editor/html';
import { templatePreviewBlocks, type PreviewBlock } from './previewBlocks';

/*
 * The Generate dialog's Template preview: the chosen template as readable text on a small sheet of paper (its font,
 * alignment and {{VARIABLE}} chips), scrolling when it is long; or, for "None", the outline of the letter the AI writes.
 */

const PAPER =
  'h-full overflow-y-auto overscroll-contain rounded-[6px] bg-white px-5 py-4 text-[13px] leading-[1.55] text-foreground shadow-soft';

const ALIGN_CLASS: Record<PreviewBlock['align'], string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

/** The chip the editor draws for a variable (4px radius, 1px 6px, 0.85em, 500, #e9f6ff on #016094). */
function Chip({ name }: { name: string }) {
  return (
    <span className="mx-px rounded-[4px] bg-sky px-1.5 py-px text-[0.85em] font-medium whitespace-nowrap text-sky-foreground">
      {`{{${name}}}`}
    </span>
  );
}

export function TemplatePreview({
  template,
  className,
}: {
  /** The chosen template, or null for "None (generate without template)". */
  template: { id: string; name: string } | null;
  className?: string;
}) {
  return (
    <div className={clsx('rounded-control border border-border bg-surface-low p-2', className)}>
      {/* Keyed, so another template starts at its top rather than at the last one's scroll position. */}
      {template ? <TemplateText key={template.id} id={template.id} name={template.name} /> : <NoTemplateOutline />}
    </div>
  );
}

function TemplateText({ id, name }: { id: string; name: string }) {
  const query = useQuery({ queryKey: templateKeys.detail(id), queryFn: () => fetchTemplate(id), staleTime: 60_000 });
  const html = query.data?.contentHtml;
  const blocks = useMemo(() => (html === undefined ? [] : templatePreviewBlocks(html)), [html]);

  if (query.isPending) {
    return (
      <div className={clsx(PAPER, 'flex items-center justify-center')}>
        <Spinner size={16} label="Loading the preview..." />
      </div>
    );
  }
  if (query.isError) {
    return <div className={clsx(PAPER, 'text-muted-foreground')}>The preview of {name} could not be loaded.</div>;
  }
  return (
    // A scrolling region reachable by keyboard, named for the template it shows.
    <div
      className={PAPER}
      style={{ fontFamily: paperFontStack(query.data.fontFamily) }}
      role="region"
      aria-label={`${name} preview`}
      tabIndex={0}
      data-template-preview={id}
    >
      {blocks.length === 0 ? (
        <p className="text-muted-foreground">
          This template is empty: its AI prompt alone guides the letter.
        </p>
      ) : (
        blocks.map((block, index) => (
          <p
            key={index}
            className={clsx(
              'min-h-[1.55em] break-words',
              ALIGN_CLASS[block.align],
              block.kind === 'heading' && 'text-[15px] font-bold',
              block.kind === 'item' && 'pl-4 -indent-3',
              index > 0 && block.parts.length > 0 && 'mt-1.5',
            )}
          >
            {block.kind === 'item' && <span aria-hidden="true">•&nbsp;</span>}
            {block.parts.map((part, partIndex) =>
              'variable' in part ? <Chip key={partIndex} name={part.variable} /> : <span key={partIndex}>{part.text}</span>,
            )}
          </p>
        ))
      )}
    </div>
  );
}

/** What generating without a template gives: the profile's name and contact line, then the AI's paragraphs. */
function NoTemplateOutline() {
  return (
    <div
      className={PAPER}
      style={{ fontFamily: paperFontStack('Times New Roman') }}
      role="region"
      aria-label="Letter outline"
      tabIndex={0}
      data-template-preview="none"
    >
      <p className="text-center text-[15px] font-bold">Your name</p>
      <p className="text-center text-muted-foreground">Phone | Email | LinkedIn</p>
      <p className="mt-4">Dear Hiring Manager,</p>
      <p className="mt-3 rounded-[4px] border border-dashed border-control-strong px-3 py-2 font-sans text-[12.5px] leading-5 text-muted-foreground">
        Three or four paragraphs, written by AI from your resume for this job, the description you paste and any custom
        prompt.
      </p>
      <p className="mt-3">Sincerely,</p>
      <p>Your name</p>
    </div>
  );
}
