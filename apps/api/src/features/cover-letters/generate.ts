import { z } from 'zod';
import {
  aiVariablesIn,
  buildContactLine,
  composeLetterHtml,
  findPlaceholders,
  formatLongDate,
  htmlToText,
  letterVariableValues,
  substituteVariables,
  type CoverLetterGenerateResult,
} from '@tailorit/shared';
import type { AiTaskContext } from '../../ai/index';
import type { AppDeps } from '../../core/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { getResumeEvidence, type ResumeEvidence } from '../resumes/evidence';
import { letterProfile, requireVisibleTemplate, visibleTemplate } from './context';
import { coverLetterPrompt, resumeForPrompt, templateFillPrompt, tidyAiText } from './prompts';
import { createLetterRepository } from './repository';
import { sanitizeLetterHtml } from './sanitize';

// The two generation tasks. Both read the person's resume (the default one unless the request names another), write
// the letter's content, mark it "Generated" and answer { html, placeholders } for the editor. Generation is not an
// edit by the person, so "Last Edited" stays as it was.

export const NO_RESUME_MESSAGE = 'Add a resume in Documents first, so the letter has your experience to draw on.';

/** What POST /:id/generate queues (validated again when the task runs: it is read back from the database). */
export const GenerateTaskInputSchema = z.object({
  letterId: z.string().min(1),
  companyName: z.string(),
  jobTitle: z.string(),
  jobDescription: z.string(),
  templateId: z.string().nullable(),
  customPrompt: z.string(),
  resumeId: z.string().nullable().optional(),
});
export type GenerateTaskInput = z.infer<typeof GenerateTaskInputSchema>;

export function noResumeError(): AppError {
  return validationFailed(NO_RESUME_MESSAGE, { resume: NO_RESUME_MESSAGE });
}

/** The resume the letter draws on, or the "add a resume first" failure. */
export function requireEvidence(deps: Pick<AppDeps, 'db'>, userId: string, resumeId?: string | null): ResumeEvidence {
  const evidence = getResumeEvidence(deps, userId, resumeId ?? undefined);
  if (!evidence) {
    if (resumeId) throw notFound('That resume');
    throw noResumeError();
  }
  return evidence;
}

/** Whether a template has anything to fill: an empty one means "write the whole letter, guided by its AI prompt". */
export function templateHasContent(contentHtml: string): boolean {
  return htmlToText(contentHtml).trim() !== '';
}

function stopIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('ai_failed', 'This AI request was cancelled.');
}

function parseInput(input: unknown): GenerateTaskInput {
  const parsed = GenerateTaskInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError('ai_failed', 'This AI request could not be read. Please try again.');
  return parsed.data;
}

function userOfTask(ctx: AiTaskContext): string {
  if (!ctx.userId) throw notFound('That cover letter');
  return ctx.userId;
}

/** `cover_letter`: AI body paragraphs in the name / contact line / greeting / sign-off wrapper. */
export async function generateWithoutTemplate(
  deps: AppDeps,
  rawInput: unknown,
  ctx: AiTaskContext,
): Promise<CoverLetterGenerateResult> {
  const input = parseInput(rawInput);
  const userId = userOfTask(ctx);
  const letters = createLetterRepository(deps);
  letters.require(input.letterId, userId);
  const evidence = requireEvidence(deps, userId, input.resumeId);
  // An empty template contributes its AI prompt (and its font) only.
  const template = input.templateId ? visibleTemplate(deps, userId, input.templateId) : null;

  const answer = await ctx.runPrompt(coverLetterPrompt, {
    job: { companyName: input.companyName, jobTitle: input.jobTitle, jobDescription: input.jobDescription },
    resume: resumeForPrompt(evidence),
    templatePrompt: template?.aiPrompt ?? '',
    customPrompt: input.customPrompt,
  });
  const paragraphs = answer.paragraphs
    .flatMap((paragraph) => tidyAiText(paragraph).split(/\n\s*\n/))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const profile = letterProfile(evidence);
  const html = sanitizeLetterHtml(
    composeLetterHtml({ name: profile.fullName, contactLine: buildContactLine(profile), paragraphs }),
  );

  stopIfCancelled(ctx.signal);
  letters.update(input.letterId, userId, {
    contentHtml: html,
    origin: 'generated',
    templateId: template?.id ?? null,
    resumeId: evidence.resumeId,
    ...(template ? { fontFamily: template.fontFamily } : {}),
  });
  return { html, placeholders: findPlaceholders(html) };
}

/**
 * `template_fill`: Profile, Dynamic and Structural variables substituted from the resume, Settings and the job; one
 * AI call writes the AI variables the template uses. Anything still without a value stays `{{NAME}}` for the
 * "Almost there" banner.
 */
export async function generateFromTemplate(
  deps: AppDeps,
  rawInput: unknown,
  ctx: AiTaskContext,
): Promise<CoverLetterGenerateResult> {
  const input = parseInput(rawInput);
  const userId = userOfTask(ctx);
  const letters = createLetterRepository(deps);
  letters.require(input.letterId, userId);
  if (!input.templateId) throw new AppError('ai_failed', 'Choose a template, then try again.');
  const template = requireVisibleTemplate(deps, userId, input.templateId);
  const evidence = requireEvidence(deps, userId, input.resumeId);
  const profile = letterProfile(evidence);
  const today = deps.now();

  const values: Record<string, string> = letterVariableValues({
    profile,
    job: { companyName: input.companyName, jobTitle: input.jobTitle, hiringManager: null },
    today,
  });
  const aiNames = aiVariablesIn(template.contentHtml);
  if (aiNames.length > 0) {
    const answer = await ctx.runPrompt(templateFillPrompt, {
      job: { companyName: input.companyName, jobTitle: input.jobTitle, jobDescription: input.jobDescription },
      resume: resumeForPrompt(evidence),
      templatePrompt: template.aiPrompt,
      customPrompt: input.customPrompt,
      templateText: htmlToText(template.contentHtml),
      names: aiNames,
      personName: profile.fullName,
      today: formatLongDate(today),
    });
    for (const name of aiNames) {
      const value = answer.values[name];
      if (typeof value === 'string' && value.trim()) values[name] = tidyAiText(value);
    }
  }
  const html = sanitizeLetterHtml(substituteVariables(template.contentHtml, values));

  stopIfCancelled(ctx.signal);
  letters.update(input.letterId, userId, {
    contentHtml: html,
    origin: 'generated',
    templateId: template.id,
    resumeId: evidence.resumeId,
    fontFamily: template.fontFamily,
  });
  return { html, placeholders: findPlaceholders(html) };
}
