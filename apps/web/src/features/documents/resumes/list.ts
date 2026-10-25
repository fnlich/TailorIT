import { editedAgo } from '@tailorit/shared/format';
import {
  RESUME_SOURCE_LABEL,
  type ResumeAnalysisBrief,
  type ResumeSource,
  type ResumeSummary,
} from '@tailorit/shared/resume';
import { newestFirst } from '../core/gallery';

/*
 * The Resumes tab's decisions, free of React: the source filter, the order, what search matches, the lines under a
 * card (when it was edited, and what TailorIT read from it) and the words of its badges and confirmations.
 */

export const RESUME_SOURCES_SHOWN: readonly ResumeSource[] = ['all', 'built', 'uploaded'];
export { RESUME_SOURCE_LABEL };

export function readSource(value: string | null | undefined): ResumeSource {
  return value === 'built' || value === 'uploaded' ? value : 'all';
}

export function filterBySource(items: readonly ResumeSummary[], source: ResumeSource): ResumeSummary[] {
  return source === 'all' ? [...items] : items.filter((item) => item.kind === source);
}

/** The default resume first, then newest first (free_tailor's profile-page order), ties by id. */
export function sortResumes(items: readonly ResumeSummary[]): ResumeSummary[] {
  const pinned = items.find((item) => item.isDefault)?.id ?? null;
  return newestFirst(items, pinned);
}

/** When a resume was last edited: its last content edit, else its last change. */
export function editedTime(item: Pick<ResumeSummary, 'lastEditedAt' | 'updatedAt'>): string {
  return item.lastEditedAt ?? item.updatedAt;
}

/** "Edited 6 hours ago", "Edited 10/15/2026"; "Not edited yet" for a time that does not read. */
export function editedText(item: Pick<ResumeSummary, 'lastEditedAt' | 'updatedAt'>, now: number): string {
  return editedAgo(editedTime(item), now) ?? 'Not edited yet';
}

/** The list's Edited column, under its own header: "6 hours ago", "10/15/2026". */
export function editedShort(item: Pick<ResumeSummary, 'lastEditedAt' | 'updatedAt'>, now: number): string {
  return editedText(item, now).replace(/^Edited /, '');
}

/** The template a resume is drawn with, by name: the API's own word, else the template list's. '' for an upload. */
export function templateNameOf(
  item: Pick<ResumeSummary, 'kind' | 'templateId' | 'templateName'>,
  templates: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (item.kind === 'uploaded') return '';
  if (item.templateName) return item.templateName;
  const wanted = item.templateId || 'default';
  return (templates.find((template) => template.id === wanted) ?? templates.find((template) => template.id === 'default'))?.name ?? '';
}

/** The card's line: "Edited 6 hours ago · Modern Two-Column" (the template left off for an upload). */
export function cardMeta(edited: string, templateName: string): string {
  return templateName ? `${edited} · ${templateName}` : edited;
}

/** What search matches: the label, the name printed on the resume, the template and (when given) its main skills. */
export function searchFieldsOf(item: ResumeSummary, templateName: string, hardSkills: readonly string[] = []): string[] {
  return [item.label, item.nameOnResume, templateName, ...hardSkills].filter(Boolean);
}

/** Years of experience, short: "Under 1 yr", "1 yr", "8 yrs"; null when none were found. */
export function yearsLabel(years: number | null | undefined): string | null {
  if (years === null || years === undefined || !Number.isFinite(years) || years < 0) return null;
  if (years < 1) return 'Under 1 yr';
  const rounded = Math.round(years);
  return rounded === 1 ? '1 yr' : `${rounded} yrs`;
}

/** The first main skills and how many more: "React, TypeScript, Node.js +9". */
export function skillsSummary(skills: readonly string[], shown = 3): string {
  const first = skills.slice(0, shown).join(', ');
  const more = skills.length - shown;
  return more > 0 ? `${first} +${more}` : first;
}

/** The card's second line: what TailorIT read from a resume. */
export interface ProfileLineView {
  /** "8 yrs · React, TypeScript, Node.js +9", "Finding skills..."; '' keeps the line's place while nothing is known. */
  text: string;
  /** The AI is reading the resume now: a small spinner leads the line. */
  refining: boolean;
  /** There is a reading to look at (an upload's line opens its page there). */
  hasReading: boolean;
}

/**
 * The line from the list's reading: years, then the first three main skills. Not read yet: "Finding skills...".
 * Nothing found yet while the AI reads it: "Finding skills..."; while it waits its turn: "Waiting for the AI reading";
 * else "No skills found". No reading in the answer at all (a change's own answer): nothing, until the list is read.
 */
export function profileLine(analysis: ResumeAnalysisBrief | null | undefined): ProfileLineView {
  if (analysis === undefined) return { text: '', refining: false, hasReading: false };
  if (analysis === null) return { text: 'Finding skills...', refining: false, hasReading: false };
  const parts = [yearsLabel(analysis.yearsExperience), skillsSummary(analysis.hardSkills)].filter(Boolean);
  if (parts.length > 0) return { text: parts.join(' · '), refining: analysis.refining, hasReading: true };
  if (analysis.refining) return { text: 'Finding skills...', refining: true, hasReading: true };
  if (analysis.aiWaiting) return { text: 'Waiting for the AI reading', refining: false, hasReading: true };
  return { text: 'No skills found', refining: false, hasReading: true };
}

/** Some reading is still to come (not read yet, or the AI is reading or about to): the list is read again. */
export function readingsPending(items: readonly ResumeSummary[] | undefined): boolean {
  return (items ?? []).some((item) => item.analysis === null || item.analysis?.refining === true || item.analysis?.aiWaiting === true);
}

/**
 * A change's answer (rename, set as default) carries no reading: the one the list already holds is kept, so the line
 * does not blink while the list is read again.
 */
export function withKnownReading(summary: ResumeSummary | null, list: readonly ResumeSummary[] | undefined): ResumeSummary | null {
  if (!summary || summary.analysis !== undefined) return summary;
  const known = list?.find((item) => item.id === summary.id)?.analysis;
  return known === undefined ? summary : { ...summary, analysis: known };
}

/** "PDF" / "DOCX" for an upload, else null. */
export function fileBadge(item: Pick<ResumeSummary, 'kind' | 'fileKind'>): string | null {
  if (item.kind !== 'uploaded' || !item.fileKind) return null;
  return item.fileKind.toUpperCase();
}

/** The bulk delete's note: "1 default resume will be skipped", or null when the default is not among them. */
export function bulkDeleteNote(selected: ReadonlyArray<Pick<ResumeSummary, 'isDefault'>>): string | null {
  const count = selected.filter((item) => item.isDefault).length;
  if (count === 0) return null;
  return `${count} default ${count === 1 ? 'resume' : 'resumes'} will be skipped`;
}

/** The toast after a bulk delete. */
export function bulkDeleteResult({ deleted, skipped }: { deleted: number; skipped: number }): string {
  const done = `Deleted ${deleted} ${deleted === 1 ? 'resume' : 'resumes'}.`;
  if (skipped <= 0) return done;
  return `${done} ${skipped} default ${skipped === 1 ? 'resume was' : 'resumes were'} skipped.`;
}

/** The empty state for a source with nothing in it while other resumes exist (All / Created / Uploaded). */
export function emptySourceCopy(source: ResumeSource): { title: string; description: string } {
  return source === 'uploaded'
    ? { title: 'No uploaded resumes yet', description: 'Upload a PDF or Word resume to keep it with your documents.' }
    : { title: 'No created resumes yet', description: 'Build a resume from a template and it shows up here.' };
}

/** The menu a resume's ⋮ offers, in order (the component maps each key to its label and action). */
export type ResumeMenuKey =
  | 'edit'
  | 'view'
  | 'details'
  | 'rename'
  | 'duplicate'
  | 'default'
  | 'pdf'
  | 'docx'
  | 'json'
  | 'file'
  | 'copy'
  | 'delete';

export function menuKeysFor(item: Pick<ResumeSummary, 'kind'>): ResumeMenuKey[] {
  return item.kind === 'built'
    ? ['edit', 'rename', 'duplicate', 'default', 'pdf', 'docx', 'json', 'delete']
    : ['view', 'details', 'rename', 'duplicate', 'default', 'file', 'copy', 'delete'];
}

/** The upload dialog's title: what the person typed, else the file's own name without its extension. */
export function uploadTitle(typed: string, fileName: string): string {
  const own = typed.trim();
  if (own) return own;
  return fileName.replace(/\.[^.]+$/, '').trim();
}

/** The toast after several uploads: "7 resumes uploaded". */
export function uploadedTitle(count: number): string {
  return `${count} ${count === 1 ? 'resume' : 'resumes'} uploaded`;
}

/** Its line when some files were not uploaded: "2 files were not uploaded." */
export function notUploadedText(count: number): string {
  return `${count} ${count === 1 ? 'file was' : 'files were'} not uploaded.`;
}

/**
 * The toast at the end of an upload run; null when nothing was uploaded. One file: "Resume uploaded" and its copy
 * being made, or its label. Several: "7 resumes uploaded", what was not, and where their editable copies are followed.
 */
export function uploadsFinishedToast(outcome: {
  mode: 'single' | 'multi';
  uploaded: ReadonlyArray<{ taskId: string | null; label: string }>;
  notUploaded: number;
  copies: boolean;
}): { title: string; description: string } | null {
  const [first] = outcome.uploaded;
  if (!first) return null;
  if (outcome.mode === 'single') {
    return { title: 'Resume uploaded', description: first.taskId ? 'An editable copy is being made from it.' : first.label };
  }
  const count = outcome.uploaded.length;
  const notUploaded = outcome.notUploaded > 0 ? notUploadedText(outcome.notUploaded) : null;
  if (!outcome.copies) return { title: uploadedTitle(count), description: notUploaded ?? 'Their skills show on each resume.' };
  const follow = count === 1 ? 'Follow its editable copy at the top of this page.' : 'Follow their editable copies at the top of this page.';
  return { title: uploadedTitle(count), description: notUploaded ? `${notUploaded} ${follow}` : follow };
}
