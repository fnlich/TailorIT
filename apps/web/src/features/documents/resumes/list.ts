import { editedAgo } from '@tailorit/shared/format';
import { RESUME_SOURCE_LABEL, type ResumeSource, type ResumeSummary } from '@tailorit/shared/resume';
import { newestFirst } from '../core/gallery';

/*
 * The Resumes tab's decisions, free of React: the source filter, the order, what search matches, the lines under a
 * card and the words of its badges and confirmations.
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

/** What search matches: the label, the name printed on the resume and the template. */
export function searchFieldsOf(item: ResumeSummary, templateName: string): string[] {
  return [item.label, item.nameOnResume, templateName].filter(Boolean);
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
    : ['view', 'rename', 'duplicate', 'default', 'file', 'copy', 'delete'];
}

/** The upload dialog's title: what the person typed, else the file's own name without its extension. */
export function uploadTitle(typed: string, fileName: string): string {
  const own = typed.trim();
  if (own) return own;
  return fileName.replace(/\.[^.]+$/, '').trim();
}
