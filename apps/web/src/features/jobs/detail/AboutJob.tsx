'use client';

import type { JobAnalysisView } from '@tailorit/shared';
import { clsx } from 'clsx';
import { useState } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SkeletonText } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';

type AboutView = 'summary' | 'full';

const VIEWS = [
  { value: 'summary', label: 'Summary' },
  { value: 'full', label: 'Full posting' },
] as const;

const SECTIONS = [
  { key: 'requirements', title: 'Requirements' },
  { key: 'responsibilities', title: 'Responsibilities' },
  { key: 'desired', title: 'Desired Qualifications' },
] as const;

/**
 * Styles for the posting's own HTML (sanitized by the API): paragraphs, headings, lists and links in the page's
 * type scale. Descendant variants keep them inside this block.
 */
const POSTING_HTML = clsx(
  'text-[15px] leading-6 text-foreground break-words',
  '[&_p]:my-3 [&_p:first-child]:mt-0',
  '[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3:first-child]:mt-0',
  '[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1.5 [&_li]:pl-1',
  '[&_a]:text-primary-ink [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_b]:font-semibold',
  '[&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2',
);

function Summary({ analysis, onShowFull }: { analysis: JobAnalysisView; onShowFull: () => void }) {
  const sections = SECTIONS.filter((section) => analysis[section.key].length > 0);
  if (sections.length === 0) {
    return (
      <p className="text-[15px] leading-6 text-muted-foreground">
        There is no summary for this posting yet.{' '}
        <button type="button" onClick={onShowFull} className="font-semibold text-primary-ink hover:underline">
          Read the full posting
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.title}>
          <h3 className="text-lg leading-7 font-semibold text-foreground">{section.title}</h3>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-5 text-foreground marker:text-foreground">
            {analysis[section.key].map((item, index) => (
              <li key={`${index}-${item}`} className="pl-0.5">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * "About the job" with Simplify's Summary | Full posting toggle. Summary lists the analysis's Requirements,
 * Responsibilities and Desired Qualifications; Full posting shows the sanitized description. A quiet "Refining…"
 * shows while the AI analysis is being made; when it lands the bullets change in place.
 */
export function AboutJob({
  analysis,
  analysisPending,
  analysisFailed = false,
  descriptionHtml,
}: {
  analysis: JobAnalysisView | undefined;
  analysisPending: boolean;
  /** The analysis could not be loaded: the full posting is shown instead of a summary. */
  analysisFailed?: boolean;
  descriptionHtml: string;
}) {
  const hasSummary = analysis
    ? analysis.requirements.length + analysis.responsibilities.length + analysis.desired.length > 0
    : !analysisFailed;
  const [chosen, setChosen] = useState<AboutView | null>(null);
  // The view the first analysis opened on stays when a refined one lands (no summary yet, then the AI's): the
  // reader is never moved from the full posting they are reading.
  const [opened, setOpened] = useState<AboutView | null>(null);
  const initial: AboutView = hasSummary ? 'summary' : 'full';
  if (opened === null && (analysis || analysisFailed)) setOpened(initial);
  const view: AboutView = chosen ?? opened ?? initial;

  return (
    <section aria-labelledby="about-the-job">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id="about-the-job" className="text-[22px] leading-9 font-bold text-foreground">
            About the job
          </h2>
          {analysis?.refining && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Spinner size={12} />
              Refining…
            </span>
          )}
        </div>
        <SegmentedControl aria-label="Job description view" items={VIEWS} value={view} onValueChange={setChosen} />
      </div>
      <div className="mt-4">
        {view === 'summary' ? (
          analysisFailed && !analysis ? (
            <p className="text-[15px] leading-6 text-muted-foreground">
              The summary could not be loaded.{' '}
              <button type="button" onClick={() => setChosen('full')} className="font-semibold text-primary-ink hover:underline">
                Read the full posting
              </button>
            </p>
          ) : analysisPending || !analysis ? (
            <SkeletonText lines={6} />
          ) : (
            <Summary analysis={analysis} onShowFull={() => setChosen('full')} />
          )
        ) : descriptionHtml ? (
          <div className={POSTING_HTML} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        ) : (
          <p className="text-[15px] text-muted-foreground">This posting has no description.</p>
        )}
      </div>
    </section>
  );
}
