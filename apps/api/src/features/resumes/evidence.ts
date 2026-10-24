import {
  normalizeResumeDocument,
  resumeEvidenceText,
  resumeLabel,
  type ResumeDocument,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';

// What other features need to know about a person's resume: the text keyword matching reads (the Jobs page's
// "Improve your resume" card, the tracker's Resume Score) and the profile cover letters fill variables from.
// Owned by work package R1; other packages import it read-only. Keep the signature stable.

export interface ResumeProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export interface ResumeEvidence {
  resumeId: string;
  kind: 'built' | 'uploaded';
  /** Display label (custom title, else the document's headline/name rule). */
  label: string;
  /** Plain text for keyword matching: the document's evidence fields, or an upload's extracted text. */
  text: string;
  /** Contact/profile details, falling back to the account and its saved preferences where the resume has none. */
  profile: ResumeProfile;
  /** The structured document (built resumes only). */
  document: ResumeDocument | null;
}

interface ResumeRow {
  id: string;
  kind: 'built' | 'uploaded';
  title: string | null;
  data: string | null;
  extracted_text: string | null;
  file_name: string | null;
}

/** A built resume's stored document, normalised again (an older stored shape reads as today's); null for an upload. */
export function storedDocumentOf(row: { kind: 'built' | 'uploaded'; data: string | null }): ResumeDocument | null {
  if (row.kind !== 'built' || !row.data) return null;
  try {
    return normalizeResumeDocument(JSON.parse(row.data));
  } catch {
    return normalizeResumeDocument({});
  }
}

/**
 * The text keyword matching reads for a resume: a built resume's evidence fields (`resumeEvidenceText`), an upload's
 * extracted text. The one rule the Jobs card, Resume Score and the resume picker share.
 */
export function evidenceTextOf(row: { kind: 'built' | 'uploaded'; data: string | null; extracted_text: string | null }): string {
  const document = storedDocumentOf(row);
  return document ? resumeEvidenceText(document) : (row.extracted_text ?? '');
}

/**
 * The evidence of one of the account's resumes: `resumeId` when given (null when it is not theirs), else the default
 * resume, else the most recently updated one. Null when the account has no resume at all.
 */
export function getResumeEvidence(
  deps: Pick<AppDeps, 'db'>,
  userId: string,
  resumeId?: string | null,
): ResumeEvidence | null {
  const user = deps.db
    .prepare('SELECT name, email, default_resume_id FROM users WHERE id = ?')
    .get(userId) as { name: string; email: string; default_resume_id: string | null } | undefined;
  if (!user) return null;

  const select =
    'SELECT r.id, r.kind, r.title, r.data, r.extracted_text, f.original_name AS file_name FROM resumes r ' +
    'LEFT JOIN stored_files f ON f.id = r.file_id AND f.user_id = r.user_id WHERE r.user_id = ?';
  let row: ResumeRow | undefined;
  if (resumeId) {
    row = deps.db.prepare(`${select} AND r.id = ?`).get(userId, resumeId) as ResumeRow | undefined;
    if (!row) return null;
  } else {
    if (user.default_resume_id) {
      row = deps.db.prepare(`${select} AND r.id = ?`).get(userId, user.default_resume_id) as ResumeRow | undefined;
    }
    row ??= deps.db
      .prepare(`${select} ORDER BY r.updated_at DESC, r.created_at DESC, r.id ASC LIMIT 1`)
      .get(userId) as ResumeRow | undefined;
    if (!row) return null;
  }

  const prefs = deps.db
    .prepare('SELECT phone, linkedin_url, location, portfolio_url FROM user_preferences WHERE user_id = ?')
    .get(userId) as { phone: string; linkedin_url: string; location: string; portfolio_url: string } | undefined;

  const document = storedDocumentOf(row);

  const contact = document?.contact;
  const pick = (...values: Array<string | null | undefined>) => values.find((v) => v && v.trim())?.trim() ?? '';
  const profile: ResumeProfile = {
    name: pick(document?.name, user.name),
    title: pick(document?.title),
    email: pick(contact?.email, user.email),
    phone: pick(contact?.phone, prefs?.phone),
    location: pick(contact?.location, prefs?.location),
    linkedin: pick(contact?.linkedin, prefs?.linkedin_url),
    github: pick(contact?.github),
    portfolio: pick(contact?.portfolio, prefs?.portfolio_url),
  };

  return {
    resumeId: row.id,
    kind: row.kind,
    // The Resumes tab's rule: a custom title, else the resume's own label (built) or the file's name (uploads).
    label: document
      ? resumeLabel(document, row.title)
      : pick(row.title, (row.file_name ?? '').replace(/\.(pdf|docx?)$/i, ''), 'Uploaded resume'),
    text: evidenceTextOf(row),
    profile,
    document,
  };
}
