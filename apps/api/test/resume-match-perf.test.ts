import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillLibrary } from '../src/core/skills-vocabulary';
import { insertResume } from '../src/features/resumes/repository';
import { signIn } from './auth-helpers';
import { createTestContext, type TestContext } from './helpers';
import { insertApplication, insertJob } from './job-fixtures';

// The resume match worker under load (work package WP5): 50 uploads of about 60,000 characters each and 500 Saved
// applications waiting for their best resume. The drain must stay cooperative: no single block of the event loop as
// long as 100 ms (monitorEventLoopDelay's max), while it links every application.

let ctx: TestContext | null = null;
afterEach(() => {
  const current = ctx;
  ctx = null;
  current?.cleanup();
});

const UPLOADS = 50;
const APPLICATIONS = 500;
const TEXT_CHARS = 60_000;

const VERBS = ['Built', 'Led', 'Designed', 'Shipped', 'Improved', 'Migrated', 'Automated', 'Scaled', 'Owned', 'Mentored'];
const NOUNS = [
  'the billing platform',
  'payment services',
  'internal tooling',
  'data pipelines',
  'the mobile app',
  'search ranking',
  'customer onboarding',
  'reporting dashboards',
  'the release process',
  'the observability stack',
];
const OUTCOMES = [
  'cutting latency by 40 percent',
  'for 2 million users',
  'with a team of five engineers',
  'ahead of the quarterly launch',
  'reducing incidents',
  'saving 300 hours a year',
];

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Made-up words, so a resume's text has thousands of distinct words as a real one does. */
function words(rand: () => number, count: number): string[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: count }, () =>
    Array.from({ length: 4 + Math.floor(rand() * 7) }, () => letters[Math.floor(rand() * letters.length)]).join(''),
  );
}

/** A long resume: roles with dates, and bullets naming this person's 30 skills among ordinary words. */
function resumeText(index: number, skills: readonly string[]): string {
  const rand = random(index * 7919 + 13);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const own = Array.from({ length: 30 }, () => pick(skills));
  const vocabulary = words(rand, 3000);
  const lines = [
    `Candidate ${index}`,
    index % 2 ? 'Senior Backend Engineer' : 'Frontend Engineer',
    'Summary',
    `Engineer with ${3 + (index % 9)} years of experience.`,
    'Experience',
  ];
  let size = lines.join('\n').length;
  let year = 2025;
  while (size < TEXT_CHARS) {
    const role = `${pick(['Software Engineer', 'Backend Engineer', 'Platform Engineer'])}, Company ${Math.floor(rand() * 1000)} | 01/${year - 2} - 06/${year}`;
    lines.push(role);
    size += role.length + 1;
    year = year <= 1990 ? 2025 : year - 2;
    for (let bullet = 0; bullet < 8; bullet += 1) {
      const line =
        `- ${pick(VERBS)} ${pick(NOUNS)} using ${pick(own)} and ${pick(own)}, ${pick(OUTCOMES)}; ` +
        `${pick(vocabulary)} ${pick(vocabulary)} ${pick(vocabulary)} ${pick(vocabulary)}.`;
      lines.push(line);
      size += line.length + 1;
    }
  }
  return lines.join('\n').slice(0, TEXT_CHARS);
}

function posting(index: number, skills: readonly string[]): string {
  const rand = random(index * 104729 + 7);
  const pick = () => skills[Math.floor(rand() * skills.length)]!;
  const bullets = Array.from({ length: 6 }, () => `<li>Production experience with ${pick()} and ${pick()}.</li>`).join('');
  return `<h3>Requirements</h3><ul>${bullets}</ul><h3>Nice to have</h3><ul><li>${pick()}</li><li>${pick()}</li></ul>`;
}

function ms(nanoseconds: number): number {
  return Math.round((nanoseconds / 1e6) * 10) / 10;
}

describe('resume match performance', () => {
  // A machine busy with the whole suite (parallel workers) can preempt this process in the middle of a slice and
  // stretch one delay past the limit; a real block of the event loop fails every attempt, so a retry tells them apart.
  it(`drains ${APPLICATIONS} Saved applications over ${UPLOADS} uploads of ~60k characters without a 100 ms block`, { retry: 2, timeout: 180_000 }, async () => {
    ctx?.cleanup();
    const c = createTestContext();
    ctx = c;
    const db = c.deps.db;
    const { account } = await signIn(c, 'perf@example.com');
    const skills = getSkillLibrary().vocabulary;

    for (let index = 0; index < UPLOADS; index += 1) {
      insertResume(c.deps, account.id, {
        kind: 'uploaded',
        title: `Resume ${index}`,
        extractedText: resumeText(index, skills),
        aiRefine: false,
      });
    }
    const jobs: number[] = [];
    for (let index = 0; index < APPLICATIONS; index += 1) {
      const id = insertJob(db, { title: index % 2 ? 'Backend Engineer' : 'Frontend Engineer', description: posting(index, skills) });
      // As ingest stores it: the job's rule-based analysis.
      c.deps.services.jobAnalysis!.get(id);
      jobs.push(id);
    }
    const apps = jobs.map((jobId) => insertApplication(db, account.id, jobId, 1));
    db.prepare('UPDATE applications SET resume_match_due = 1').run();
    const service = c.deps.services.resumeMatch!;

    const histogram = monitorEventLoopDelay({ resolution: 5 });
    histogram.enable();
    const started = performance.now();
    const settled = await service.runDue();
    const elapsed = performance.now() - started;
    histogram.disable();

    const linked = db
      .prepare("SELECT count(*) AS n FROM applications WHERE resume_origin = 'auto' AND resume_id IS NOT NULL AND resume_match_due = 0")
      .get() as { n: number };
    console.log(
      `[resume-match perf] runDue: ${settled} applications in ${Math.round(elapsed)} ms; event loop delay max ` +
        `${ms(histogram.max)} ms, p99 ${ms(histogram.percentile(99))} ms, mean ${ms(histogram.mean)} ms`,
    );
    expect(settled).toBe(APPLICATIONS);
    expect(linked.n).toBe(apps.length);
    expect(ms(histogram.max)).toBeLessThan(100);

    // Save all's case: the chooser over 100 jobs within its 2 s budget, read-only.
    const choose = monitorEventLoopDelay({ resolution: 5 });
    choose.enable();
    const chooseStarted = performance.now();
    const { choices, unfinished } = await service.chooseForJobs(account.id, jobs.slice(0, 100), { budgetMs: 2_000 });
    const chooseElapsed = performance.now() - chooseStarted;
    choose.disable();
    console.log(
      `[resume-match perf] chooseForJobs: ${choices.size} of 100 jobs in ${Math.round(chooseElapsed)} ms ` +
        `(${unfinished.length} unfinished); event loop delay max ${ms(choose.max)} ms`,
    );
    expect(choices.size + unfinished.length).toBe(100);
    expect(ms(choose.max)).toBeLessThan(100);
    expect(chooseElapsed).toBeLessThan(2_000 + 500);
  });
});
