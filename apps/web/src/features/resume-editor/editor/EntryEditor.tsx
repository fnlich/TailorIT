'use client';

import {
  achievementsFromText,
  bulletCountNote,
  bulletsBlocker,
  bulletsTask,
  readBullets,
  type BulletsTask,
  type FieldSpec,
  type SectionSpec,
} from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { TrashIcon } from '@/components/ui/icons';
import { Input, Textarea } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { api, userMessage } from '@/lib/api';
import { useAiTask } from '@/lib/useAiTask';
import { requestBullets } from '../api';
import {
  addRoleSkill,
  bulletsRequestFor,
  cleanChip,
  hasChip,
  removeRoleSkill,
  replaceEntry,
  technicalSkillRefusal,
  type DraftEntry,
  type EntryRef,
  type ResumeDraft,
} from '../draft';
import { AiButton, ChipInput, ChipList, EditorPanel, type UpdateDraft } from './parts';

function fieldValue(row: object, name: string): string {
  const value = (row as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

/**
 * The Edit Entry panel: the entry's fields (two to a row when the column is wide), a role's "Skills used", and for a
 * kind with bullets the achievements box with Write with AI under it. Every change goes into the draft at once (the
 * preview keeps up); Done closes the panel, and the editor drops a row left blank.
 */
export function EntryEditor({
  spec,
  entryRef,
  row,
  draft,
  update,
  sectionLabel,
  libraryListId,
  ensureLibrarySkill,
  onDone,
  onDelete,
}: {
  spec: SectionSpec;
  entryRef: EntryRef;
  row: DraftEntry;
  draft: ResumeDraft;
  update: UpdateDraft;
  sectionLabel: string;
  libraryListId: string;
  ensureLibrarySkill: (skill: string) => Promise<string>;
  onDone: () => void;
  onDelete: () => void;
}) {
  const patch = useCallback(
    (change: object, immediate = false) => update((current) => replaceEntry(current, entryRef, change), { immediate }),
    [update, entryRef],
  );

  return (
    <EditorPanel
      title={`Edit ${spec.entryNoun}`}
      eyebrow={sectionLabel}
      onBack={onDone}
      onDone={onDone}
      actions={<IconButton label={`Delete this ${spec.entryNoun}`} tooltip="Delete" icon={<TrashIcon size={18} />} onClick={onDelete} />}
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 @lg:grid-cols-2">
        {spec.fields.map((field, index) => (
          <EntryField
            key={field.name}
            field={field}
            id={`entry-${field.name}-${row.key}`}
            value={fieldValue(row, field.name)}
            onChange={(value) => patch({ [field.name]: value })}
            autoFocus={index === 0}
          />
        ))}
      </div>
      {entryRef.kind === 'experience' && (
        <RoleSkills
          rowKey={row.key}
          skills={'skills' in row && Array.isArray(row.skills) ? row.skills : []}
          update={update}
          libraryListId={libraryListId}
          ensureLibrarySkill={ensureLibrarySkill}
        />
      )}
      {spec.hasBullets && <BulletsField spec={spec} row={row} draft={draft} patch={patch} />}
    </EditorPanel>
  );
}

function EntryField({
  field,
  id,
  value,
  onChange,
  autoFocus,
}: {
  field: FieldSpec;
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
}) {
  const wide = field.wide ? '@lg:col-span-2' : undefined;
  if (field.input === 'textarea') {
    return (
      <Field label={field.label} id={id} className={wide}>
        <Textarea value={value} rows={3} placeholder={field.placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }
  // Text for links on purpose: the browser's url check refuses "github.com/you"; inputMode still picks the keyboard.
  const type = field.input === 'email' || field.input === 'tel' ? field.input : 'text';
  return (
    <Field label={field.label} id={id} className={wide}>
      <Input
        type={type}
        inputMode={field.input === 'url' ? 'url' : undefined}
        value={value}
        placeholder={field.placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A role's skills: a skill used in a role is one the resume claims, so it joins Technical skills too. */
function RoleSkills({
  rowKey,
  skills,
  update,
  libraryListId,
  ensureLibrarySkill,
}: {
  rowKey: string;
  skills: readonly string[];
  update: UpdateDraft;
  libraryListId: string;
  ensureLibrarySkill: (skill: string) => Promise<string>;
}) {
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const add = async () => {
    const value = cleanChip(pending);
    if (!value) return;
    if (hasChip(skills, value)) {
      setPending('');
      return;
    }
    const refusal = technicalSkillRefusal(skills, value);
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const skill = await ensureLibrarySkill(value);
      update((current) => addRoleSkill(current, rowKey, skill));
      setPending('');
    } catch (caught) {
      setError(userMessage(caught, 'Could not add that skill. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="Skills used" id={id} hint="Each skill also joins your Technical skills.">
      <div className="flex flex-col gap-3">
        <ChipInput
          id={id}
          list={libraryListId}
          value={pending}
          onChange={(value) => {
            setPending(value);
            setError(null);
          }}
          onAdd={() => void add()}
          busy={busy}
          error={error}
          placeholder="Select or add a hard skill"
          label="Add a skill used in this role"
        />
        <ChipList
          label="Skills used in this role"
          items={skills}
          onRemove={(skill) => update((current) => removeRoleSkill(current, rowKey, skill))}
        />
      </div>
    </Field>
  );
}

interface BulletsRun {
  taskId: string | null;
  task: BulletsTask;
  /** What Undo puts back. */
  previous: string;
  /** The request itself failed (the task never started). */
  error: string | null;
}

/**
 * The achievements box and Write with AI under it: the button ("Write" while the box is empty, "Improve" once it has
 * bullets), an optional note to the AI, and the last run's state: running, its failure, or its answer with Undo while
 * the box still holds that answer. The panel closing cancels a run still in progress, so an answer never lands in a
 * box that is gone.
 */
function BulletsField({
  spec,
  row,
  draft,
  patch,
}: {
  spec: SectionSpec;
  row: DraftEntry;
  draft: ResumeDraft;
  patch: (change: object, immediate?: boolean) => void;
}) {
  const value = fieldValue(row, 'achievementsText');
  const boxId = useId();
  const blockerId = useId();
  const [note, setNote] = useState('');
  const [run, setRun] = useState<BulletsRun | null>(null);
  const ai = useAiTask(run?.taskId ?? null, { kind: 'entry_bullets' });

  const aiKind = spec.aiKind;
  const task = bulletsTask(value);
  const blocker = aiKind ? bulletsBlocker(aiKind, row) : null;
  const answer = run?.taskId && ai.isSucceeded ? readBullets(ai.task?.result).join('\n') : null;
  const running = run !== null && run.error === null && (run.taskId === null || ai.isRunning);
  const failure =
    run?.error ??
    (run?.taskId && ai.isFailed ? (ai.errorMessage ?? 'Write with AI did not finish. Please try again.') : null) ??
    (answer === '' ? 'The answer held no bullets. Please try again.' : null);
  const done = run && answer && value === answer ? run : null;

  // The answer goes into the box once, when it arrives.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!run?.taskId || !answer || applied.current === run.taskId) return;
    applied.current = run.taskId;
    patch({ achievementsText: answer }, true);
  }, [run, answer, patch]);

  // A run still going when the panel closes is cancelled.
  const live = useRef<{ taskId: string | null; running: boolean }>({ taskId: null, running: false });
  useEffect(() => {
    live.current = { taskId: run?.taskId ?? null, running };
  });
  useEffect(
    () => () => {
      const { taskId, running: stillRunning } = live.current;
      if (taskId && stillRunning) void api.delete(`/api/ai/tasks/${encodeURIComponent(taskId)}`).catch(() => undefined);
    },
    [],
  );

  const ask = async () => {
    if (!aiKind || blocker || running) return;
    const request = bulletsRequestFor(aiKind, row, draft, task, note);
    const ticket: BulletsRun = { taskId: null, task, previous: value, error: null };
    setRun(ticket);
    try {
      const taskId = await requestBullets(request);
      setRun((current) => (current === ticket ? { ...ticket, taskId } : current));
    } catch (caught) {
      const error = userMessage(caught, 'Write with AI could not start. Please try again.');
      setRun((current) => (current === ticket ? { ...ticket, error } : current));
    }
  };

  const count = achievementsFromText(value).length;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Achievements, one per line" id={boxId} hint={bulletCountNote(count) ?? undefined}>
        <Textarea
          value={value}
          rows={Math.min(12, Math.max(4, count + 1))}
          placeholder={'Led a team of 5 engineers...\nImproved performance by 50%...'}
          disabled={running}
          onChange={(event) => patch({ achievementsText: event.target.value })}
        />
      </Field>
      {aiKind && (
        <div className="flex flex-col gap-2.5 rounded-control border border-improve-border bg-improve/40 p-3">
          <div className="flex flex-col gap-2 @md:flex-row @md:items-center">
            <AiButton onClick={() => void ask()} disabled={Boolean(blocker)} running={running} describedBy={blocker ? blockerId : undefined}>
              {task === 'improve' ? 'Improve with AI' : 'Write with AI'}
            </AiButton>
            <div className="min-w-0 flex-1">
              <Input
                aria-label="A note for the AI (optional)"
                placeholder="Optional: what to bring out, e.g. the cost savings"
                maxLength={300}
                value={note}
                disabled={running}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void ask();
                }}
              />
            </div>
          </div>
          {blocker && (
            <p id={blockerId} className="text-[13px] leading-5 text-muted-foreground">
              {blocker}
            </p>
          )}
          {running && (
            <Spinner size={14} label={(run?.task ?? task) === 'improve' ? 'Improving the bullets...' : 'Writing the bullets...'} />
          )}
          {failure && !running && (
            <Notice
              tone="error"
              action={
                <Button variant="outline" size="sm" onClick={() => setRun(null)}>
                  Dismiss
                </Button>
              }
            >
              {failure}
            </Notice>
          )}
          {done && (
            <p role="status" className={clsx('flex flex-wrap items-center gap-2 text-[13px] leading-5 font-medium text-[#02703c]')}>
              {done.task === 'improve' ? 'Bullets improved.' : 'Bullets written.'}
              <button
                type="button"
                className="font-semibold text-primary-ink underline-offset-2 hover:underline"
                onClick={() => {
                  patch({ achievementsText: done.previous }, true);
                  setRun(null);
                }}
              >
                Undo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
