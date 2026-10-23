import {
  CoverLetterParagraphsSchema,
  TemplateFillValuesSchema,
  variableDefinition,
  type CoverLetterParagraphs,
  type ResumeDocument,
  type TemplateFillValues,
} from '@tailorit/shared';
import type { PromptModule } from '../../ai/index';
import type { ResumeEvidence } from '../resumes/evidence';

// The two letter prompts. `cover_letter` writes the body paragraphs of a letter without a template (the server wraps
// them in the name / contact line / greeting / sign-off). `template_fill` writes the AI-generated placeholders of a
// template. Both draw facts only from the person's resume and read the job description.

const JOB_DESCRIPTION_LIMIT = 20_000;
const RESUME_TEXT_LIMIT = 20_000;
const GUIDANCE_LIMIT = 5_000;

export interface LetterJobInput {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
}

export interface CoverLetterPromptInput {
  job: LetterJobInput;
  /** The resume as JSON (built resumes) or its extracted text (uploads). */
  resume: string;
  /** The chosen template's "Copilot AI Prompt", when the letter is generated from an empty template. */
  templatePrompt: string;
  customPrompt: string;
}

export interface TemplateFillPromptInput extends CoverLetterPromptInput {
  /** The template as plain text, placeholders written {{NAME}}. */
  templateText: string;
  /** The AI placeholders to write. */
  names: string[];
  personName: string;
  today: string;
}

const BANNED_WORDS =
  'leveraged, utilized, spearheaded, orchestrated, streamlined, seamless, robust, scalable, maximized, ' +
  'cross-functional, end-to-end, innovative, dynamic, cutting-edge, world-class, state-of-the-art, holistic, ' +
  'comprehensive, proven, strategic';

const SHARED_RULES = `Truthfulness
- Every fact about the person comes from the RESUME section. Never invent, guess or adjust an employer, title, date, number, product, customer, team size, colleague, technology, skill or field, and never round or restate a figure in other units.
- Facts about the company come only from the job description. When it says little about the company, write about the work itself instead.
- When the resume gives little to work with, write less and keep it plain rather than padding it with claims.
- The person's instructions and the template guidance shape tone, emphasis and length. They never override these truthfulness rules.

Style
- First person, in the person's own voice: warm, specific and confident, never stiff or salesy.
- Vary the length of sentences. Do not open sentences with resume verbs such as Designed, Architected, Led, Delivered, Drove, Integrated, Partnered, Supported, Contributed, Managed or Streamlined.
- Never use these words in any form: ${BANNED_WORDS}.
- No metaphors and no stock phrases such as "I look forward to hearing from you" or "I am writing to express my interest".
- Never use an em dash, an en dash or a double hyphen. Use a comma or a full stop instead.
- Plain text only: no markdown, no HTML, no bullet points, no headings.`;

/** The resume as the prompt shows it: the document's facts as JSON (no contact details), or an upload's text. */
export function resumeForPrompt(evidence: ResumeEvidence): string {
  const document = evidence.document;
  if (!document) return evidence.text.slice(0, RESUME_TEXT_LIMIT);
  return JSON.stringify(compactResume(document), null, 1).slice(0, RESUME_TEXT_LIMIT);
}

function present<T>(value: T): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** Drops empty strings, lists and objects, so the prompt carries only what the person wrote. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune).filter(present);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, prune(inner)] as const)
      .filter(([, inner]) => present(inner));
    return Object.fromEntries(entries);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function compactResume(document: ResumeDocument): unknown {
  return prune({
    name: document.name,
    title: document.title,
    totalYearsExperience: document.totalYearsExperience,
    summary: document.summary,
    experience: document.experience.map((entry) => ({
      title: entry.title,
      company: entry.company,
      startDate: entry.startDate,
      endDate: entry.endDate,
      location: entry.location,
      description: entry.description,
      achievements: entry.achievements,
      skills: entry.skills,
    })),
    strengths: document.strengths,
    skills: document.skills,
    skillCategories: document.skillCategories,
    softSkills: document.softSkills,
    education: document.education.map((entry) => ({
      degree: entry.degree,
      institution: entry.institution,
      startDate: entry.startDate,
      endDate: entry.endDate,
      achievements: entry.achievements,
    })),
    certifications: document.certifications?.map((entry) => ({ name: entry.name, issuer: entry.issuer, date: entry.date })),
    projects: document.projects?.map((entry) => ({
      name: entry.name,
      role: entry.role,
      description: entry.description,
      achievements: entry.achievements,
    })),
    volunteering: document.volunteering?.map((entry) => ({
      role: entry.role,
      organization: entry.organization,
      description: entry.description,
      achievements: entry.achievements,
    })),
    awards: document.awards?.map((entry) => ({ title: entry.title, issuer: entry.issuer, description: entry.description })),
    publications: document.publications?.map((entry) => ({ title: entry.title, description: entry.description })),
    languages: document.languages,
    courses: document.courses?.map((entry) => ({ name: entry.name, institution: entry.institution })),
  });
}

function block(title: string, body: string): string {
  const text = body.trim();
  return `${title}\n<<<\n${text || '(none given)'}\n>>>`;
}

function jobBlock(job: LetterJobInput): string {
  return [
    'JOB',
    `Company: ${job.companyName.trim() || '(not given)'}`,
    `Title: ${job.jobTitle.trim() || '(not given)'}`,
    block('Job description', job.jobDescription.slice(0, JOB_DESCRIPTION_LIMIT)),
  ].join('\n');
}

function guidanceBlocks(input: CoverLetterPromptInput): string[] {
  const out: string[] = [];
  if (input.templatePrompt.trim()) {
    out.push(block('TEMPLATE GUIDANCE (from the template the person chose)', input.templatePrompt.slice(0, GUIDANCE_LIMIT)));
  }
  if (input.customPrompt.trim()) {
    out.push(
      block(
        "THE PERSON'S INSTRUCTIONS (follow them within the rules; if they pasted an old letter, reuse its true facts and voice, not its wording)",
        input.customPrompt.slice(0, GUIDANCE_LIMIT),
      ),
    );
  }
  return out;
}

export const coverLetterPrompt: PromptModule<CoverLetterPromptInput, CoverLetterParagraphs> = {
  kind: 'cover_letter',
  version: 1,
  system: () => `You write the body of a cover letter for a job seeker, as the job seeker.

What to write
- Three or four paragraphs: only the part between the greeting and the sign-off. No greeting, no sign-off, no name, no contact details and no date; the app adds those.
- The first paragraph begins with the word "I".
- Write for this job at this company. Use the job title and the company name, and answer what the job description asks for with the person's real experience.
- A good shape: open with why this work appeals to the person, naming their years of experience or their field only when the resume states it. Then tell one concrete accomplishment from the resume as a short story that leads to what this role needs. Then a second moment that shows how the person works or what they care about. Then what draws them to this company or this kind of work, grounded in the job description. End with one confident, specific closing sentence.
- About 250 to 400 words in all, shorter when the resume is thin or the person asks for it.

${SHARED_RULES}

Answer with {"paragraphs": ["...", "...", "..."]}: three or four strings, one per paragraph, each a few sentences long.`,
  user: (input) =>
    [jobBlock(input.job), block('RESUME (the only source of facts about the person)', input.resume), ...guidanceBlocks(input)].join(
      '\n\n',
    ),
  output: CoverLetterParagraphsSchema,
};

/** What each AI placeholder asks the model for (TailorIT's own registry words, made into instructions). */
const AI_VARIABLE_BRIEF: Record<string, string> = {
  FULL_COVER_LETTER:
    'The whole letter: a greeting line, three or four body paragraphs, a sign-off line and the person\'s name, each separated by a blank line.',
  COVER_LETTER_BODY: 'Three or four body paragraphs separated by blank lines. No greeting and no sign-off.',
  COMPANY_APPEAL: 'Two or three sentences on what draws the person to this company and its work, grounded in the job description.',
  ROLE_FIT: 'Two to four sentences connecting the person\'s experience to what the role asks for.',
  CANDIDATE_STRENGTHS: 'Two to four sentences on the strengths from the resume that matter most for this job.',
  SKILL_HIGHLIGHT: 'Two or three sentences showing one skill the job needs in action, through a real example from the resume.',
};

function placeholderList(names: string[]): string {
  return names
    .map((name) => {
      const brief = AI_VARIABLE_BRIEF[name] ?? variableDefinition(name)?.description ?? 'What the name and the text around it ask for, in one to three sentences.';
      return `- ${name}: ${brief}`;
    })
    .join('\n');
}

export const templateFillPrompt: PromptModule<TemplateFillPromptInput, TemplateFillValues> = {
  kind: 'template_fill',
  version: 1,
  system: () => `You fill in the AI-written parts of a cover letter template for a job seeker, as the job seeker.

The template is a letter of fixed text with placeholders written {{NAME}}. The app fills the person's details, the company, the job title and the date itself. You write only the placeholders listed under PLACEHOLDERS TO WRITE.
- Read the whole template first. Each value must read naturally in its place: continue the sentence or paragraph around it, and never repeat what the fixed text already says (if the template already greets the reader or names the role, do not do it again).
- A value that stands alone as a paragraph may hold several paragraphs separated by a blank line only when its description says so; otherwise write one paragraph.
- Never write placeholders, brackets or notes of your own, and do not wrap values in quotes.

${SHARED_RULES}

Answer with {"values": {"NAME": "text", ...}}, one entry for every placeholder listed under PLACEHOLDERS TO WRITE.`,
  user: (input) =>
    [
      block('TEMPLATE (placeholders written {{NAME}})', input.templateText),
      `PLACEHOLDERS TO WRITE\n${placeholderList(input.names)}`,
      `THE LETTER IS FROM\n${input.personName.trim() || '(the person; their name is not on the resume)'}, dated ${input.today}.`,
      jobBlock(input.job),
      block('RESUME (the only source of facts about the person)', input.resume),
      ...guidanceBlocks(input),
    ].join('\n\n'),
  output: TemplateFillValuesSchema,
};

/**
 * The house style the prompts ask for, enforced on the answer: dashes become commas (a range of numbers keeps a plain
 * hyphen), stray markdown emphasis is dropped, spaces are tidied.
 */
export function tidyAiText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*(?:—|–|\s--\s)\s*/g, ', ')
    .replace(/(^|\s)--(\s|$)/g, '$1,$2')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]+,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
