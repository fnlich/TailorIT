'use client';

import { PaletteIcon } from '@phosphor-icons/react/Palette';
import {
  CUSTOM_SECTION_SPEC,
  DEFAULT_SECTION_KINDS,
  MAX_RESUME_TITLE_LENGTH,
  SECTION_KINDS,
  SECTION_KIND_BY_ID,
  customSectionRef,
  effectiveSectionOrder,
  keptNote,
  moveSection,
  newCustomSectionKey,
  parseSectionRef,
  presenceOf,
  resumeLabel,
  sampledNotice,
  type SectionKind,
  type TechnicalSkillsLayout,
} from '@tailorit/shared/resume';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { EditorBar } from '@/components/shell/EditorBar';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FileTextIcon, PlusIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl, TabPanel } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import {
  RESUMES_TAB_HREF,
  addSkill,
  createResume,
  fetchSkills,
  fetchTemplates,
  renameResume,
  resumeKeys,
  updateResume,
  type PreviewAnswer,
  type PreviewBody,
  type ResumeView,
} from '../api';
import {
  addCustomSection,
  addSectionKind,
  appendEntry,
  draftForNewResume,
  draftFromDocument,
  draftToDocument,
  drawnTemplate,
  emptyEntry,
  entriesOf,
  entryCount,
  entryListOf,
  findEntry,
  headingOptions as headingOptionsOf,
  isBlankEntry,
  keptCount,
  librarySpelling,
  removeEntry,
  removeSection,
  removeSectionQuestion,
  renameCustomSection,
  sectionMeta,
  sectionSourceOf,
  templatePrintsRef,
  type EntryListRef,
  type EntryRef,
  type ResumeDraft,
} from '../draft';
import type { StartChoice } from '../gallery';
import { invalidateResumes, putResumeInList } from '../cache';
import { WIDE_EDITOR_QUERY, useMediaQuery } from '../hooks';
import { PreviewPane } from '../preview/PreviewPane';
import { useLeaveGuard } from '../useLeaveGuard';
import { AddContentDialog } from './AddContentDialog';
import { InterestsCard, SoftSkillsCard, SummaryCard, TechnicalSkillsCard } from './ContentCards';
import { LayoutSettings, TemplateSettings } from './CustomizeTab';
import { EntryEditor } from './EntryEditor';
import { EntrySection } from './EntrySection';
import { BasicsPanel, EditorHeaderCard } from './HeaderCard';
import { ImportStartDialog } from './ImportStartDialog';
import { KeptLine, SwitchCapabilityNote, SwitchRow, type UpdateDraft } from './parts';
import type { CardFrame } from './SectionCard';
import { SortableSections } from './SortableSections';

/** The shared <datalist> of the hard-skill library, rendered once for every skill box. */
const LIBRARY_LIST_ID = 'resume-hard-skill-library';
/** How long typing must pause before the preview is drawn again. */
const TYPING_DEBOUNCE_MS = 400;

type View = 'content' | 'customize';
type Pane = 'form' | 'preview';
/** What has taken the column's place: the name and contact details, or one entry. */
type Editing = { panel: 'basics' } | ({ panel: 'entry' } & EntryRef);

const VIEWS = [
  { value: 'content' as const, label: 'Content', icon: <FileTextIcon size={16} /> },
  { value: 'customize' as const, label: 'Customize', icon: <PaletteIcon size={16} /> },
];
const PANES = [
  { value: 'form' as const, label: 'Form' },
  { value: 'preview' as const, label: 'Preview' },
];

const SkillLibrary = memo(function SkillLibrary({ skills }: { skills: readonly string[] }) {
  return (
    <datalist id={LIBRARY_LIST_ID}>
      {skills.map((skill) => (
        <option key={skill} value={skill} />
      ))}
    </datalist>
  );
});

/** Focuses the first element found of `selectors`, once the page has re-rendered (a panel closed, a card moved). */
function focusSoon(...selectors: string[]) {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      for (const selector of selectors) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element && !element.matches(':disabled')) {
          element.focus();
          return;
        }
      }
    }),
  );
}

const sectionSelector = (ref: string) => `[data-section="${CSS.escape(ref)}"]`;

/**
 * The resume editor (free_tailor's, in Simplify's look): the bar (Documents › name, save state, Create / Save), the
 * Content and Customize tabs on the left and the live preview on the right. Content is the header card, a card per
 * section in the order the resume prints them (drag, Move up / down, Add content, Remove section) and the panels that
 * edit one thing at a time; Customize is the template and the layout. Nothing is saved until Create / Save, and
 * leaving with changes asks first.
 */
export function ResumeEditor({
  resume,
  start,
  offerImport = false,
}: {
  /** The stored resume (built), or null for a new one. */
  resume: ResumeView | null;
  /** A new resume's template and layout, from the chooser. */
  start?: StartChoice;
  /** Ask "Import your existing resume" first (a new resume from the chooser). */
  offerImport?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const wide = useMediaQuery(WIDE_EDITOR_QUERY);

  const [initial] = useState<ResumeDraft>(() =>
    resume?.document ? draftFromDocument(resume.document) : draftForNewResume(start ?? { templateId: '', layout: 'categorized' }),
  );
  const [draft, setDraft] = useState<ResumeDraft>(initial);
  const baseline = useMemo(() => JSON.stringify(initial), [initial]);
  const [quickPreview, setQuickPreview] = useState(true);
  const [view, setView] = useState<View>('content');
  const [pane, setPane] = useState<Pane>('form');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ ref: string; question: string } | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<{ ref: EntryRef; noun: string } | null>(null);
  const [offeringImport, setOfferingImport] = useState(() => offerImport && !resume);
  const [customTitle, setCustomTitle] = useState<string | null>(resume?.title ?? null);
  const [ownSkills, setOwnSkills] = useState<string[]>([]);

  const templatesQuery = useQuery({
    queryKey: resumeKeys.templates(),
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 5 * 60_000,
  });
  const libraryQuery = useQuery({
    queryKey: resumeKeys.skills('hard'),
    queryFn: ({ signal }) => fetchSkills('hard', signal),
    staleTime: 30 * 60_000,
  });
  const libraryData = libraryQuery.data;
  const library = useMemo(() => [...(libraryData ?? []), ...ownSkills], [libraryData, ownSkills]);

  const update: UpdateDraft = useCallback((recipe, options) => {
    setDraft((current) => recipe(current));
    setQuickPreview(options?.immediate === true);
  }, []);

  const dirty = JSON.stringify(draft) !== baseline;
  const leave = useLeaveGuard(dirty && !saving);

  // ------------------------------------------------------------------------------------------------- templates

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const templatesStatus = templatesQuery.isPending ? 'loading' : templatesQuery.isError ? 'error' : 'ready';
  const { stored: chosenTemplate, drawn: drawnWith } = drawnTemplate(templates, draft.preferredTemplate);
  const template = chosenTemplate ?? drawnWith;
  const templateName = useCallback((id: string) => templates.find((item) => item.id === id)?.name ?? id, [templates]);
  const selectedName = template?.name ?? 'This template';
  const selectedId = draft.preferredTemplate || template?.id || 'default';

  // ----------------------------------------------------------------------------------------------- the order

  const native = template && template.nativeSectionOrder.length > 0 ? template.nativeSectionOrder : DEFAULT_SECTION_KINDS;
  const displayed = effectiveSectionOrder(draft.sectionOrder ?? [], native, presenceOf(sectionSourceOf(draft)));
  const ownOrder = draft.sectionOrder !== null;

  const sectionLabel = useCallback(
    (ref: string): string => {
      const parsed = parseSectionRef(ref);
      if (!parsed) return ref;
      if (parsed.kind === 'custom') {
        return draft.customSections.find((section) => section.key === parsed.key)?.title.trim() || CUSTOM_SECTION_SPEC.label;
      }
      return SECTION_KIND_BY_ID[parsed.kind].label;
    },
    [draft.customSections],
  );

  const setOrder = (order: string[]) => update((current) => ({ ...current, sectionOrder: order }), { immediate: true });

  const announceMove = (ref: string, order: readonly string[], direction?: 'up' | 'down') => {
    const where = `now ${order.indexOf(ref) + 1} of ${order.length}`;
    setAnnounce(direction ? `${sectionLabel(ref)} moved ${direction}, ${where}.` : `${sectionLabel(ref)} moved, ${where}.`);
  };

  const move = (ref: string, delta: number) => {
    const next = moveSection(displayed, ref, delta);
    if (next.join('\n') === displayed.join('\n')) return;
    setOrder(next);
    announceMove(ref, next, delta < 0 ? 'up' : 'down');
    // The card moved and may have been taken out of the page and put back: keep the keyboard on its button.
    focusSoon(`${sectionSelector(ref)} [data-move="${delta < 0 ? 'up' : 'down'}"]`, `${sectionSelector(ref)} button[aria-expanded]`);
  };

  // ---------------------------------------------------------------------------------------- adding, removing

  const availableKinds = SECTION_KINDS.filter((kind) => !kind.isDefault && !displayed.includes(kind.id));

  const addKind = (kind: SectionKind) => {
    update((current) => addSectionKind(current, kind, displayed), { immediate: true });
    setJustAdded(kind);
    setAdding(false);
  };

  const addCustom = (title: string) => {
    const key = newCustomSectionKey(undefined, draft.customSections.map((section) => section.key));
    update((current) => addCustomSection(current, key, title, displayed), { immediate: true });
    setJustAdded(customSectionRef(key));
    setAdding(false);
  };

  const requestRemove = (ref: string) => {
    const question = removeSectionQuestion(sectionLabel(ref), entryCount(draft, ref));
    if (question) setRemoving({ ref, question });
    else update((current) => removeSection(current, ref, displayed), { immediate: true });
  };

  // ------------------------------------------------------------------------------------------------ panels

  // Derived, not stored: a row deleted from under the panel closes it.
  const panel = useMemo(() => {
    if (!editing) return null;
    if (editing.panel === 'basics') return { panel: 'basics' as const };
    const ref: EntryRef =
      editing.kind === 'custom'
        ? { kind: 'custom', sectionKey: editing.sectionKey, key: editing.key }
        : { kind: editing.kind, key: editing.key };
    const row = findEntry(draft, ref);
    return row ? { panel: 'entry' as const, ref, row } : null;
  }, [editing, draft]);

  const openPanel = (next: Editing) => {
    setEditing(next);
    window.scrollTo({ top: 0 });
  };

  const openEntry = (list: EntryListRef, key: string) => openPanel({ panel: 'entry', ...list, key });

  const addEntry = (list: EntryListRef) => {
    const entry = emptyEntry(list.kind === 'custom' ? 'custom' : list.kind);
    update((current) => appendEntry(current, list, entry));
    openPanel({ panel: 'entry', ...list, key: entry.key });
  };

  const sectionRefOf = (ref: EntryListRef) => (ref.kind === 'custom' ? customSectionRef(ref.sectionKey) : ref.kind);

  const closePanel = () => {
    if (panel?.panel === 'entry') {
      const { ref, row } = panel;
      if (isBlankEntry(row)) update((current) => removeEntry(current, ref));
      focusSoon(`${sectionSelector(sectionRefOf(ref))} button[aria-expanded]`);
    } else {
      focusSoon('button[aria-label="Edit name and contact details"]');
    }
    setEditing(null);
  };

  const requestDeleteEntry = () => {
    if (panel?.panel !== 'entry') return;
    const { ref, row } = panel;
    const spec = ref.kind === 'custom' ? CUSTOM_SECTION_SPEC : SECTION_KIND_BY_ID[ref.kind];
    if (isBlankEntry(row)) {
      update((current) => removeEntry(current, ref), { immediate: true });
      setEditing(null);
      return;
    }
    setDeletingEntry({ ref, noun: spec.entryNoun });
  };

  // ------------------------------------------------------------------------------------------------- skills

  /**
   * The library's spelling of a skill, adding it to the person's own skills first when the library lacks it. The
   * skill is the resume's either way: a failure to remember it for next time does not stop it being added.
   */
  const ensureLibrarySkill = useCallback(
    async (value: string) => {
      const known = librarySpelling(library, value);
      if (known) return known;
      let skill = value.replace(/\s+/g, ' ').trim();
      try {
        skill = await addSkill('hard', skill);
      } catch {
        // Kept as typed; the next add tries the library again.
      }
      setOwnSkills((current) => (librarySpelling(current, skill) ? current : [...current, skill]));
      return skill;
    },
    [library],
  );

  const headingOptions = useMemo(() => headingOptionsOf(draft), [draft]);

  // -------------------------------------------------------------------------------------------------- cards

  const frameFor = (ref: string, grip: ReactNode, dragging: boolean, removable: boolean): CardFrame => {
    const index = displayed.indexOf(ref);
    return {
      grip,
      dragging,
      move: {
        up: () => move(ref, -1),
        down: () => move(ref, 1),
        canUp: index > 0,
        canDown: index >= 0 && index < displayed.length - 1,
      },
      meta: sectionMeta(draft, ref) || undefined,
      onRemove: removable ? () => requestRemove(ref) : undefined,
      focusOnMount: justAdded === ref,
    };
  };

  const renderCard = (ref: string, grip: ReactNode, dragging: boolean): ReactNode => {
    const parsed = parseSectionRef(ref);
    if (!parsed) return null;
    const isCustom = parsed.kind === 'custom';
    const removable = isCustom || !DEFAULT_SECTION_KINDS.includes(parsed.kind as SectionKind);
    const frame = frameFor(ref, grip, dragging, removable);
    const prints = templatePrintsRef(template, ref);

    if (parsed.kind === 'custom') {
      const section = draft.customSections.find((item) => item.key === parsed.key);
      if (!section) return null;
      const list: EntryListRef = { kind: 'custom', sectionKey: parsed.key };
      return (
        <EntrySection
          sectionRef={ref}
          kind="custom"
          label={section.title.trim() || CUSTOM_SECTION_SPEC.label}
          spec={CUSTOM_SECTION_SPEC}
          entries={section.entries}
          onOpen={(key) => openEntry(list, key)}
          onAdd={() => addEntry(list)}
          frame={frame}
          templatePrints={prints}
          templateName={selectedName}
          customTitle={{
            id: `section-title-${parsed.key}`,
            value: section.title,
            onChange: (title) => update((current) => renameCustomSection(current, parsed.key, title)),
          }}
        />
      );
    }

    const kind = parsed.kind;
    const spec = SECTION_KIND_BY_ID[kind];
    switch (spec.editor) {
      case 'summary':
        return <SummaryCard draft={draft} update={update} frame={frame} />;
      case 'skills':
        return (
          <TechnicalSkillsCard
            draft={draft}
            update={update}
            headingOptions={headingOptions}
            libraryListId={LIBRARY_LIST_ID}
            ensureLibrarySkill={ensureLibrarySkill}
            frame={frame}
          />
        );
      case 'softSkills':
        return (
          <SoftSkillsCard
            draft={draft}
            update={update}
            templateSupports={template ? template.supportsSoftSkills : null}
            templateName={selectedName}
            frame={frame}
          />
        );
      case 'chips':
        return <InterestsCard draft={draft} update={update} templatePrints={prints} templateName={selectedName} frame={frame} />;
      case 'entries': {
        const list = entryListOf(kind);
        if (!list) return null;
        if (kind === 'strengths') {
          const on = draft.settings.includeStrengths;
          return (
            <EntrySection
              sectionRef={ref}
              kind={kind}
              label={spec.label}
              spec={spec}
              entries={entriesOf(draft, list)}
              onOpen={(key) => openEntry(list, key)}
              onAdd={() => addEntry(list)}
              frame={frame}
              templatePrints={null}
              templateName={selectedName}
              showRows={on}
              header={
                <>
                  <SwitchRow
                    id="resume-include-strengths"
                    checked={on}
                    title="Print a Strengths section"
                    onCheckedChange={(checked) =>
                      update((current) => ({ ...current, settings: { ...current.settings, includeStrengths: checked } }), {
                        immediate: true,
                      })
                    }
                  >
                    {on ? 'Your strengths print as you write them here.' : 'Off: no Strengths section is printed.'}
                  </SwitchRow>
                  <SwitchCapabilityNote
                    on={on}
                    supported={template ? template.supportsStrengths : null}
                    section="Strengths"
                    templateName={selectedName}
                  />
                  {!on && <KeptLine note={keptNote(keptCount(draft, 'strengths'), 'strengths')} />}
                </>
              }
            />
          );
        }
        return (
          <EntrySection
            sectionRef={ref}
            kind={kind}
            label={spec.label}
            spec={spec}
            entries={entriesOf(draft, list)}
            onOpen={(key) => openEntry(list, key)}
            onAdd={() => addEntry(list)}
            frame={frame}
            templatePrints={prints}
            templateName={selectedName}
          />
        );
      }
    }
  };

  // -------------------------------------------------------------------------------------------- the preview

  const resumeId = resume?.id;
  const previewRequest = useMemo<PreviewBody>(
    () => ({ document: draftToDocument(draft), ...(resumeId ? { resumeId } : {}) }),
    [draft, resumeId],
  );

  const previewNotes = (shown: PreviewAnswer, request: PreviewBody): ReactNode => {
    const sample = sampledNotice(shown.sampled);
    const wanted = typeof request.document?.preferredTemplate === 'string' ? request.document.preferredTemplate : '';
    const fellBack = templatesStatus === 'ready' && wanted !== '' && shown.templateId !== '' && shown.templateId !== wanted;
    if (!sample && !fellBack) return null;
    return (
      <>
        {fellBack && (
          <Notice tone="info">Drawn with {templateName(shown.templateId)}: the template this resume names is not offered any more.</Notice>
        )}
        {sample && (
          <p role="status" className="rounded-control border border-dashed border-control-strong px-3 py-2 text-[13px] leading-5 text-muted-foreground">
            {sample}
          </p>
        )}
      </>
    );
  };

  // ------------------------------------------------------------------------------------------------- saving

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const document = draftToDocument(draft);
    try {
      const saved = resume ? await updateResume(resume.id, document) : await createResume(document);
      putResumeInList(queryClient, saved.summary);
      void invalidateResumes(queryClient);
      toast.success(resume ? 'Resume saved' : 'Resume created', resumeLabel(draft, customTitle));
      // Still "saving" while the page changes, so a second press cannot send it twice.
      router.push(RESUMES_TAB_HREF);
    } catch (caught) {
      const message = userMessage(caught, 'Could not save the resume. Please try again.');
      setSaveError(message);
      setSaving(false);
      toast.error('The resume was not saved', message);
      window.scrollTo({ top: 0 });
    }
  };

  const rename = resume
    ? async (name: string) => {
        const saved = await renameResume(resume.id, name);
        setCustomTitle(name);
        putResumeInList(queryClient, saved.summary);
        void invalidateResumes(queryClient);
      }
    : undefined;

  const chooseView = (next: View) => {
    if (next === view) return;
    setView(next);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };

  const changeLayout = (next: TechnicalSkillsLayout) => {
    if (next === draft.settings.technicalSkillsLayout) return;
    update((current) => ({ ...current, settings: { ...current.settings, technicalSkillsLayout: next } }), { immediate: true });
  };

  const barName = resume ? resumeLabel(draft, customTitle) : 'New resume';
  const statusText = dirty ? 'Unsaved changes' : resume ? 'No changes yet' : 'Nothing entered yet';
  const previewActive = wide || pane === 'preview';

  return (
    <>
      <EditorBar
        name={barName}
        documentsHref={RESUMES_TAB_HREF}
        onRename={rename}
        validateName={(name) => (name.length > MAX_RESUME_TITLE_LENGTH ? `A resume name can be at most ${MAX_RESUME_TITLE_LENGTH} characters.` : null)}
        maxNameLength={MAX_RESUME_TITLE_LENGTH}
        info={resume ? 'This name is only for your documents list. The resume prints the name and title you enter below.' : undefined}
        status={
          <span data-save-state={dirty ? 'dirty' : 'clean'} className={clsx('inline-flex items-center gap-2', dirty && 'font-medium text-primary-ink')}>
            <span aria-hidden="true" className={clsx('size-2 rounded-full', dirty ? 'bg-primary' : 'bg-control-strong')} />
            {statusText}
          </span>
        }
        actions={
          <Button onClick={() => void save()} loading={saving}>
            {saving ? 'Saving...' : resume ? 'Save Resume' : 'Create Resume'}
          </Button>
        }
      />

      <div className={clsx('mx-auto flex w-full max-w-[1600px] flex-col pt-5 pb-10', PAGE_GUTTER)}>
        <h1 className="sr-only">{resume ? 'Edit resume' : 'New resume'}</h1>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <SkillLibrary skills={library} />

        {saveError && (
          <Notice tone="error" title="The resume was not saved" className="mb-4">
            {saveError}
          </Notice>
        )}

        {!wide && (
          <SegmentedControl items={PANES} value={pane} onValueChange={setPane} aria-label="Editor" className="mb-4 self-start" />
        )}

        <div className="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] min-[1100px]:items-start min-[1100px]:gap-8">
          <div className={clsx('min-w-0', !wide && pane !== 'form' && 'hidden')}>
            <SegmentedControl items={VIEWS} value={view} onValueChange={chooseView} aria-label="Editor views">
              <TabPanel value="content" keepMounted className="mt-4">
                {panel?.panel === 'basics' && <BasicsPanel draft={draft} update={update} onDone={closePanel} />}
                {panel?.panel === 'entry' && (
                  <EntryEditor
                    key={panel.row.key}
                    spec={panel.ref.kind === 'custom' ? CUSTOM_SECTION_SPEC : SECTION_KIND_BY_ID[panel.ref.kind]}
                    entryRef={panel.ref}
                    row={panel.row}
                    draft={draft}
                    update={update}
                    sectionLabel={sectionLabel(sectionRefOf(panel.ref))}
                    libraryListId={LIBRARY_LIST_ID}
                    ensureLibrarySkill={ensureLibrarySkill}
                    onDone={closePanel}
                    onDelete={requestDeleteEntry}
                  />
                )}
                {/* Mounted while a panel is up, so an open card and a half-typed skill are still there after it. */}
                <div hidden={panel !== null} className="flex flex-col gap-3">
                  <EditorHeaderCard draft={draft} onEdit={() => openPanel({ panel: 'basics' })} />
                  <SortableSections
                    order={displayed}
                    labelOf={sectionLabel}
                    onReorder={(next, moved) => {
                      setOrder(next);
                      announceMove(moved, next);
                    }}
                  >
                    {(ref, grip, dragging) => renderCard(ref, grip, dragging)}
                  </SortableSections>
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-surface border border-dashed border-control-strong bg-surface/60 text-[15px] font-semibold text-primary-ink transition-colors duration-150 hover:border-primary hover:bg-primary-50"
                  >
                    <PlusIcon size={18} weight="bold" />
                    Add content
                  </button>
                </div>
              </TabPanel>
              <TabPanel value="customize" keepMounted className="mt-4">
                <div className="flex flex-col gap-3">
                  <TemplateSettings
                    templates={templates}
                    status={templatesStatus}
                    selectedId={selectedId}
                    onSelect={(templateId) => update((current) => ({ ...current, preferredTemplate: templateId }), { immediate: true })}
                  />
                  <LayoutSettings
                    layout={draft.settings.technicalSkillsLayout}
                    onLayoutChange={changeLayout}
                    ownOrder={ownOrder}
                    onUseTemplateOrder={() => update((current) => ({ ...current, sectionOrder: null }), { immediate: true })}
                  />
                </div>
              </TabPanel>
            </SegmentedControl>
          </div>

          <aside
            aria-label="Resume preview"
            className={clsx(
              'min-w-0',
              wide ? 'sticky top-[83px] h-[calc(100dvh-103px)]' : pane !== 'preview' && 'hidden',
            )}
          >
            <PreviewPane
              request={previewRequest}
              active={previewActive}
              debounceMs={quickPreview ? 0 : TYPING_DEBOUNCE_MS}
              templateName={templateName}
              notes={previewNotes}
              scrolls={wide}
            />
          </aside>
        </div>
      </div>

      <AddContentDialog
        open={adding}
        onOpenChange={setAdding}
        available={availableKinds}
        customCount={draft.customSections.length}
        onAddKind={addKind}
        onAddCustom={addCustom}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove section"
        description={removing?.question}
        confirmLabel="Remove"
        onConfirm={() => {
          const ref = removing?.ref;
          if (ref) update((current) => removeSection(current, ref, displayed), { immediate: true });
        }}
      />
      <ConfirmDialog
        open={deletingEntry !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingEntry(null);
        }}
        title={`Delete this ${deletingEntry?.noun ?? 'entry'}?`}
        description="It is removed when you save the resume."
        confirmLabel="Delete"
        onConfirm={() => {
          const ref = deletingEntry?.ref;
          if (!ref) return;
          update((current) => removeEntry(current, ref), { immediate: true });
          setEditing(null);
          focusSoon(`${sectionSelector(sectionRefOf(ref))} button[aria-expanded]`);
        }}
      />
      {leave.dialog}
      {!resume && start && (
        <ImportStartDialog
          open={offeringImport}
          templateId={start.templateId}
          layout={start.layout}
          templateName={template?.name ?? 'the template you chose'}
          onStartBlank={() => setOfferingImport(false)}
        />
      )}
    </>
  );
}
