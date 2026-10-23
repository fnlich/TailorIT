'use client';

import { clsx } from 'clsx';
import { AppHeader } from '@/components/shell/AppHeader';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { StaticAuthProvider } from '@/lib/auth';
import { CoverLettersDemo, DocumentsReplica, ResumeCardsDemo } from './DocumentsDemo';
import { KIT_ACCOUNT } from './fixtures';
import { ButtonsSection, DisplaySection, EditorBarSection, FormsSection, OverlaysSection, PillsSection } from './KitSections';

const SECTIONS = [
  ['documents', 'Documents (table)'],
  ['letters-grid', 'Cover letters (grid)'],
  ['resume-cards', 'Resumes (cards)'],
  ['buttons', 'Buttons'],
  ['forms', 'Forms'],
  ['pills', 'Pills & tabs'],
  ['overlays', 'Overlays'],
  ['display', 'Display'],
  ['editor-bar', 'Editor bar'],
] as const;

/**
 * Development-only page (/dev/kit): the header with a fake account, Simplify's Documents page rebuilt from the
 * generic layer with fake data, then every kit component. No API needed.
 */
export function KitShowcase() {
  return (
    <StaticAuthProvider account={KIT_ACCOUNT}>
      <div className="min-h-dvh bg-canvas">
        <AppHeader activePath="/documents" />
        <div className={clsx('mx-auto w-full max-w-[1600px] pt-9 pb-24', PAGE_GUTTER)}>
          <section id="documents" aria-label="Documents page replica">
            <DocumentsReplica />
          </section>

          <nav aria-label="Kit sections" className="mt-16 flex flex-wrap gap-2 border-t border-border pt-6">
            {SECTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="mt-8 flex flex-col gap-12">
            <section id="letters-grid" aria-labelledby="letters-grid-title" className="scroll-mt-24 border-t border-border pt-8">
              <h2 id="letters-grid-title" className="text-lg font-semibold">
                Cover letters: table variant with Grid | List
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Thumbnails load lazily (IntersectionObserver, 300 px) through the LRU cache; the view is remembered.
              </p>
              <div className="mt-5">
                <CoverLettersDemo />
              </div>
            </section>
            <section id="resume-cards" aria-labelledby="resume-cards-title" className="scroll-mt-24 border-t border-border pt-8">
              <h2 id="resume-cards-title" className="text-lg font-semibold">
                Resumes: cards variant (free_tailor list and thumbnail views)
              </h2>
              <div className="mt-5">
                <ResumeCardsDemo />
              </div>
            </section>
            <ButtonsSection />
            <FormsSection />
            <PillsSection />
            <OverlaysSection />
            <DisplaySection />
            <EditorBarSection />
          </div>
        </div>
      </div>
    </StaticAuthProvider>
  );
}
