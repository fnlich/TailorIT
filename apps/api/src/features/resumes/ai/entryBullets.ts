import { z } from 'zod';
import {
  BulletsRequestSchema,
  BulletsResultSchema,
  MAX_AI_BULLETS,
  MAX_BULLET_LENGTH,
  type BulletsRequest,
  type BulletsResult,
} from '@tailorit/shared';
import type { AiTaskContext, PromptModule } from '../../../ai/index';
import { AppError } from '../../../core/http/errors';

// Write with AI / Improve with AI: the bullets of one entry (a role, a project or a volunteering entry), from the
// facts in it and the person's optional note. Nothing is stored; the editor puts the answer into its draft.

const BANNED_WORDS = [
  'leveraged',
  'utilized',
  'spearheaded',
  'orchestrated',
  'streamlined',
  'seamless',
  'robust',
  'scalable',
  'maximized',
  'synergy',
  'cross-functional',
  'end-to-end',
  'innovative',
  'dynamic',
  'cutting-edge',
  'world-class',
  'best-in-class',
  'state-of-the-art',
  'holistic',
  'comprehensive',
  'extensive',
  'proven',
  'strategic',
  'mission-critical',
];

const WEAK_OPENERS = ['Designed', 'Architected', 'Led', 'Delivered', 'Drove', 'Integrated', 'Partnered', 'Supported', 'Contributed', 'Managed', 'Helped'];

const SYSTEM = `You write the achievement bullets for ONE entry on a person's resume: a job, a project or a volunteering
role. The bullets are printed under that entry exactly as you return them.

Rules:
- Use only facts that are in the entry or in the person's note. Never invent an employer, product, team size, figure,
  percentage, date or technology. When the entry has few facts, write fewer bullets rather than pad them.
- Keep every figure the entry already has, exactly as written.
- Each bullet is one line of 8 to 28 words: a single sentence fragment, no full stop at the end, no sub-bullets.
- Start each bullet with a verb: past tense for an entry that has ended, present tense for a current one (its end
  date is empty or "Present"). Never start two bullets with the same word.
- Say what was done and what it changed, in plain words, the way an engineer describes their own work. No
  pronouns: no "I", "we", "our" or "the team".
- Never use these words in any form: ${BANNED_WORDS.join(', ')}.
- Do not start a bullet with ${WEAK_OPENERS.join(', ')}. Verbs like built, wrote, shipped, cut, rewrote, fixed,
  migrated, ran, owned, taught and launched are the kind wanted.
- No em dashes or en dashes, no "--", no bold, no markdown, no emoji, no bullet characters at the start.
- Name the technologies the entry lists where a bullet is really about them, in the entry's own spelling.

The answer is {"bullets": ["first bullet", "second bullet"]}.`;

interface BulletsPromptInput {
  person: Record<string, unknown>;
  entry: Record<string, unknown>;
  task: string;
  note: string;
}

export const entryBulletsPrompt: PromptModule<BulletsPromptInput, { bullets: string[] }> = {
  kind: 'entry_bullets',
  version: 1,
  system: () => SYSTEM,
  user: (input) =>
    [
      `THE PERSON:\n${JSON.stringify(input.person)}`,
      `THE ENTRY:\n${JSON.stringify(input.entry)}`,
      `THE TASK:\n${input.task}`,
      `THE PERSON'S NOTE (may be empty):\n${input.note}`,
    ].join('\n\n'),
  output: z.object({ bullets: z.array(z.string()).min(1).max(20) }),
};

const clean = (value: unknown, max = 500) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : [];

/** The entry as the prompt reads it: what it is, what names it, and its facts. */
function entryForPrompt(request: BulletsRequest): Record<string, unknown> {
  const entry = request.entry;
  const naming =
    request.kind === 'experience'
      ? { role: clean(entry.title), organization: clean(entry.company ?? entry.organization) }
      : request.kind === 'project'
        ? { project: clean(entry.name ?? entry.title), role: clean(entry.role) }
        : { role: clean(entry.role ?? entry.title), organization: clean(entry.organization) };
  return {
    kind: request.kind,
    ...naming,
    startDate: clean(entry.startDate, 40),
    endDate: clean(entry.endDate, 40),
    location: clean(entry.location),
    description: clean(entry.description, 2000),
    bullets: strings(entry.achievements),
    skills: strings(entry.skills),
  };
}

function taskSentence(request: BulletsRequest): string {
  const existing = strings(request.entry.achievements).length;
  if (request.task === 'write') {
    return (
      'Write 3 to 8 new bullets for this entry from the facts in it.' +
      (existing > 0 ? ' Its current bullets are notes you may take facts from, but write every bullet afresh.' : '')
    );
  }
  return (
    "Improve the entry's existing bullets: keep every fact and figure, tighten the wording, open each with a strong " +
    'verb and add nothing that is not in the entry. Return one improved bullet for each existing bullet, in the same ' +
    'order, merging two only when they say the same thing.'
  );
}

/**
 * A bullet as it may print: markup and markers gone, dashes made plain ("2019–2021" keeps a hyphen, any other dash
 * becomes a comma), one line, no full stop, at most 300 characters (cut at a word).
 */
export function cleanBullet(raw: string): string {
  let bullet = raw
    .replace(/<\/?(?:b|strong|em|i)>/gi, '')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*•·–—]+|\d{1,2}[.)])\s*/, '')
    .replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, '-')
    .replace(/\s*(?:[–—]|\s--\s)\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,\s*$/, '')
    .trim();
  if (/[^.]\.$/.test(bullet)) bullet = bullet.slice(0, -1);
  if (bullet.length > MAX_BULLET_LENGTH) {
    const cut = bullet.slice(0, MAX_BULLET_LENGTH);
    const space = cut.lastIndexOf(' ');
    bullet = (space > MAX_BULLET_LENGTH - 60 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '').trim();
  }
  return bullet;
}

/** The answer's bullets, cleaned, repeats dropped, at most eight. */
export function finishBullets(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw) {
    const bullet = cleanBullet(line);
    const key = bullet.toLowerCase();
    if (!bullet || seen.has(key)) continue;
    seen.add(key);
    out.push(bullet);
    if (out.length >= MAX_AI_BULLETS) break;
  }
  return out;
}

/** The `entry_bullets` task. */
export async function runEntryBullets(raw: unknown, ctx: AiTaskContext): Promise<BulletsResult> {
  const request = BulletsRequestSchema.parse(raw);
  const resume = request.resume ?? {};
  const answer = await ctx.runPrompt(entryBulletsPrompt, {
    person: {
      name: clean(resume.name),
      headline: clean(resume.title),
      ...(typeof resume.totalYearsExperience === 'number' ? { yearsOfExperience: resume.totalYearsExperience } : {}),
      summary: clean(resume.summary, 2000),
      skills: strings(resume.skills).slice(0, 60),
    },
    entry: entryForPrompt(request),
    task: taskSentence(request),
    note: clean(request.instructions, 300),
  });
  const bullets = finishBullets(answer.bullets);
  if (bullets.length === 0) throw new AppError('ai_failed', 'The AI answered with no usable bullets. Please try again.');
  return BulletsResultSchema.parse({ bullets });
}
