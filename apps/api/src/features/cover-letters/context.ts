import { htmlToText, type LetterProfile } from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { notFound } from '../../core/http/errors';
import type { ResumeEvidence } from '../resumes/evidence';

// What a letter is about and who writes it: the tracked application or job it comes from, the template it starts
// from, and the person's profile (from their resume, with Settings filling the gaps).

export interface JobFacts {
  applicationId: string | null;
  jobId: number | null;
  companyName: string;
  jobTitle: string;
  jobDescription: string;
}

/** One of the account's tracked applications as letter facts, or 404. */
export function applicationFacts(deps: Pick<AppDeps, 'db'>, userId: string, applicationId: string): JobFacts {
  const row = deps.db
    .prepare('SELECT id, job_id, title, company_name, description_html FROM applications WHERE id = ? AND user_id = ?')
    .get(applicationId, userId) as
    | { id: string; job_id: number | null; title: string; company_name: string; description_html: string }
    | undefined;
  if (!row) throw notFound('That application');
  let description = htmlToText(row.description_html ?? '');
  let jobId = row.job_id;
  // An application saved from Jobs may not carry the posting's text; the job does.
  if (!description && jobId !== null) description = jobFactsOrNull(deps, jobId)?.jobDescription ?? '';
  if (jobId !== null && !jobExists(deps, jobId)) jobId = null;
  return {
    applicationId: row.id,
    jobId,
    companyName: row.company_name,
    jobTitle: row.title,
    jobDescription: description,
  };
}

function jobExists(deps: Pick<AppDeps, 'db'>, jobId: number): boolean {
  return Boolean(deps.db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId));
}

function jobFactsOrNull(deps: Pick<AppDeps, 'db'>, jobId: number): JobFacts | null {
  const row = deps.db
    .prepare(
      `SELECT j.id, j.title, j.description_text, j.description_html, c.name AS company_name
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    )
    .get(jobId) as
    | { id: number; title: string; description_text: string; description_html: string; company_name: string | null }
    | undefined;
  if (!row) return null;
  return {
    applicationId: null,
    jobId: row.id,
    companyName: row.company_name ?? '',
    jobTitle: row.title,
    jobDescription: row.description_text || htmlToText(row.description_html ?? ''),
  };
}

/** A job from the Jobs page as letter facts, or 404. */
export function jobFacts(deps: Pick<AppDeps, 'db'>, jobId: number): JobFacts {
  const facts = jobFactsOrNull(deps, jobId);
  if (!facts) throw notFound('That job');
  return facts;
}

export interface TemplateRecord {
  id: string;
  name: string;
  isSystem: boolean;
  contentHtml: string;
  contentText: string;
  fontFamily: string;
  aiPrompt: string;
}

/** A template the account may use (a system template or one of its own), or null. */
export function visibleTemplate(deps: Pick<AppDeps, 'db'>, userId: string, templateId: string): TemplateRecord | null {
  const row = deps.db
    .prepare(
      `SELECT id, name, is_system, content_html, content_text, font_family, ai_prompt FROM cover_letter_templates
        WHERE id = ? AND (is_system = 1 OR user_id = ?)`,
    )
    .get(templateId, userId) as
    | {
        id: string;
        name: string;
        is_system: number;
        content_html: string;
        content_text: string;
        font_family: string;
        ai_prompt: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isSystem: row.is_system === 1,
    contentHtml: row.content_html,
    contentText: row.content_text,
    fontFamily: row.font_family,
    aiPrompt: row.ai_prompt,
  };
}

export function requireVisibleTemplate(deps: Pick<AppDeps, 'db'>, userId: string, templateId: string): TemplateRecord {
  const template = visibleTemplate(deps, userId, templateId);
  if (!template) throw notFound('That template');
  return template;
}

export function requireOwnResume(deps: Pick<AppDeps, 'db'>, userId: string, resumeId: string): void {
  const row = deps.db.prepare('SELECT 1 FROM resumes WHERE id = ? AND user_id = ?').get(resumeId, userId);
  if (!row) throw notFound('That resume');
}

/** The person a letter is written for, from their resume's evidence (which already falls back to Settings). */
export function letterProfile(evidence: ResumeEvidence): LetterProfile {
  const { profile } = evidence;
  return {
    fullName: profile.name,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.linkedin,
    portfolio: profile.portfolio,
    title: profile.title,
  };
}
