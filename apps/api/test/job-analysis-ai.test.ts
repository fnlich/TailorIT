import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requireAi } from '../src/ai/index';
import { repoRoot } from '../src/core/paths';
import {
  finishAiAnalysis,
  grounded,
  numbersOf,
  numbersStated,
  postingEvidence,
  withFallbackKeywords,
  type AnalysisFallback,
} from '../src/features/job-analysis/ai';
import { analyzeDeterministic, inPostingCase, postingSpelling } from '../src/features/job-analysis/deterministic';
import { JobAnalysisOutputSchema, jobAnalysisPrompt } from '../src/features/job-analysis/prompt';
import type { JobAnalysisServiceInternals } from '../src/features/job-analysis/service';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

// The AI job analysis made safe to show (src/features/job-analysis/ai.ts): keywords filled out from the deterministic
// reading, bullets checked for the posting's numbers and skills, keywords labelled as the posting writes them; and
// the fake CLI's posting-aware answer (tools/fake-claude/scenarios/job_analysis.mjs).

const POSTING = {
  title: 'Principal Full-Stack Engineer',
  text: [
    'Responsibilities',
    '- Ship features across the stack with Node.js, React and PostgreSQL',
    '- Help improve developer tooling and CI/CD pipelines',
    'Requirements',
    '- 8+ years of relevant professional experience',
    '- Proficiency in TypeScript, Node.js and React',
    '- Experience with SQL databases and schema design',
    '- 1–2 years leading a team of 3 or more engineers',
    'Nice to have',
    '- Experience with AWS services such as Lambda and S3',
    '- Familiarity with Stripe or other payment APIs',
  ].join('\n'),
};

const DETERMINISTIC: AnalysisFallback = {
  requirements: ['8+ years of relevant professional experience', 'Proficiency in TypeScript, Node.js and React'],
  responsibilities: ['Ship features across the stack with Node.js, React and PostgreSQL'],
  desired: ['Experience with AWS services such as Lambda and S3'],
  keywords: {
    high: [
      { term: 'React', synonyms: ['React.js', 'ReactJS'] },
      { term: 'Node.js', synonyms: ['NodeJS', 'Node JS'] },
      { term: 'TypeScript', synonyms: ['TS'] },
    ],
    low: [
      { term: 'PostgreSQL', synonyms: ['Postgres'] },
      { term: 'Aws Services', synonyms: [] },
      { term: 'Lambda', synonyms: [] },
      { term: 'S3', synonyms: ['Amazon S3'] },
    ],
  },
};

function output(overrides: Record<string, unknown> = {}) {
  return JobAnalysisOutputSchema.parse({
    summary: { requirements: [], responsibilities: [], desiredQualifications: [] },
    keywords: { high: [], low: [] },
    ...overrides,
  });
}

const terms = (groups: Array<{ term: string }>) => groups.map((group) => group.term);

describe('keywords: the deterministic ones fill in for an empty or short list', () => {
  it('uses the deterministic keywords when none of the model\'s are in the posting', () => {
    const finished = finishAiAnalysis(
      output({ keywords: { high: [{ term: 'Haskell' }, { term: 'Go' }], low: [{ term: 'Kubernetes' }] } }),
      POSTING,
      DETERMINISTIC,
    );
    expect(terms(finished.keywords.high)).toEqual(['React', 'Node.js', 'TypeScript']);
    // Labelled as the posting writes them: never the library's "Aws Services".
    expect(terms(finished.keywords.low)).toEqual(['PostgreSQL', 'AWS services', 'Lambda', 'S3']);
  });

  it('adds the deterministic keywords a short list lacks (by synonym), high ones first, up to the target', () => {
    const finished = finishAiAnalysis(
      output({ keywords: { high: [{ term: 'ReactJS' }, { term: 'Haskell' }], low: [{ term: 'Postgres' }] } }),
      { ...POSTING, text: `${POSTING.text}\nWe also use ReactJS and Postgres.` },
      DETERMINISTIC,
    );
    // "ReactJS" is React and "Postgres" is PostgreSQL: neither comes back a second time.
    expect(terms(finished.keywords.high)).toEqual(['ReactJS', 'Node.js', 'TypeScript']);
    expect(terms(finished.keywords.low)).toEqual(['Postgres', 'AWS services', 'Lambda', 'S3']);
  });

  it('caps the filled-out list at the target and keeps a long list as the model gave it', () => {
    const many = {
      high: Array.from({ length: 10 }, (_, index) => ({ term: `Skill${index}`, synonyms: [] })),
      low: Array.from({ length: 10 }, (_, index) => ({ term: `Tool${index}`, synonyms: [] })),
    };
    const text = [...many.high, ...many.low].map((group) => group.term).join(', ');
    const short = withFallbackKeywords(
      { high: [{ term: 'Skill0', synonyms: [] }], low: [{ term: 'Tool0', synonyms: [] }] },
      many,
      text,
      new Set(['skill0', 'tool0']),
    );
    expect(short.high.length + short.low.length).toBe(12);
    expect(terms(short.high)).toEqual(['Skill0', ...many.high.slice(1).map((group) => group.term)]);
    expect(terms(short.low)).toEqual(['Tool0', 'Tool1']);

    const enough = { high: many.high.slice(0, 3), low: many.low.slice(0, 2) };
    expect(withFallbackKeywords(enough, DETERMINISTIC.keywords, text, new Set())).toBe(enough);
    // Without deterministic keywords (an older caller), the model's list stands.
    const one = { high: [{ term: 'Skill0', synonyms: [] }], low: [] };
    expect(withFallbackKeywords(one, undefined, text, new Set())).toBe(one);
  });
});

describe('bullets: the posting\'s numbers and skills only', () => {
  it('drops a bullet whose number the posting does not state, and keeps ranges and "N+" as written', () => {
    const finished = finishAiAnalysis(
      output({
        summary: {
          requirements: [
            '5+ years of experience building backend services in Go',
            '8+ years of relevant professional experience',
            '1-2 years leading a team of 3 or more engineers',
            'Proficiency in TypeScript, Node.js and React',
          ],
          responsibilities: [],
          desiredQualifications: ['Experience with AWS services such as Lambda and S3', 'Improve conversion by 40%'],
        },
      }),
      POSTING,
      DETERMINISTIC,
    );
    expect(finished.requirements).toEqual([
      '8+ years of relevant professional experience',
      '1-2 years leading a team of 3 or more engineers',
      'Proficiency in TypeScript, Node.js and React',
    ]);
    expect(finished.desired).toEqual(['Experience with AWS services such as Lambda and S3']);
  });

  it('reads numbers one way: dashes, "to", "or more", "at least", percent and thousands', () => {
    const posting = numbersOf('3 to 5 years; at least 2 years of Go; 10,000 users; 40 percent; 5 or more releases; 1–2 weeks');
    expect(numbersStated('3-5 years of experience', posting)).toBe(true);
    expect(numbersStated('2+ years of Go', posting)).toBe(true);
    expect(numbersStated('Serve 10000 users', posting)).toBe(true);
    expect(numbersStated('Cut costs by 40%', posting)).toBe(true);
    expect(numbersStated('5+ releases a year', posting)).toBe(true);
    expect(numbersStated('1-2 weeks of travel', posting)).toBe(true);
    // A plain number counts wherever the posting has it; "N+", ranges and percentages only as written.
    expect(numbersStated('4 years of experience', posting)).toBe(false);
    expect(numbersStated('3+ years of experience', posting)).toBe(false);
    expect(numbersStated('2-4 years', posting)).toBe(false);
    expect(numbersStated('Cut costs by 50%', posting)).toBe(false);
    expect(numbersStated('Experience with ES6 and HTML5', posting)).toBe(true);
  });

  it("drops a bullet naming a skill the posting does not, or a keyword the model made up; synonyms count", () => {
    const evidence = postingEvidence(`${POSTING.title}\n${POSTING.text}\nWe run Postgres at American Express scale.`, [
      { term: 'Haskell', synonyms: [] },
    ]);
    expect(grounded('Ship features across the stack with Node.js, React and PostgreSQL', evidence)).toBe(true);
    // Go and Kubernetes are skills, and the posting names neither.
    expect(grounded('Ship features across the stack with Go and React', evidence)).toBe(false);
    expect(grounded('Kubernetes', evidence)).toBe(false);
    // A keyword the model listed that the posting never names.
    expect(grounded('Help improve developer tooling in Haskell', evidence)).toBe(false);
    // "Express" in "American Express" names no framework, in the posting or in a bullet.
    expect(grounded('Proficiency in TypeScript, Node.js and Express', evidence)).toBe(false);
    // The word test still applies; given only the posting's words, it is the only test.
    expect(grounded('Fluency in ancient Sumerian poetry traditions', evidence)).toBe(false);
    expect(grounded('Kubernetes', new Set(['react']))).toBe(true);
  });

  it('falls back to the deterministic section when every bullet of it goes', () => {
    const finished = finishAiAnalysis(
      output({
        summary: {
          requirements: ['5+ years of experience building backend services in Go', 'Hands-on Kubernetes experience'],
          responsibilities: ['Ship features across the stack with Node.js, React and PostgreSQL'],
          desiredQualifications: [],
        },
      }),
      POSTING,
      DETERMINISTIC,
    );
    expect(finished.requirements).toEqual(DETERMINISTIC.requirements);
    expect(finished.responsibilities).toEqual(['Ship features across the stack with Node.js, React and PostgreSQL']);
    expect(finished.desired).toEqual(DETERMINISTIC.desired);
  });
});

describe('keyword labels: the posting\'s own casing', () => {
  it('labels the model\'s and the merged keywords as the posting writes them, else as the skill library does', () => {
    const finished = finishAiAnalysis(
      output({
        keywords: {
          high: [
            { term: 'typescript' },
            { term: 'NODE.JS' },
            { term: 'kubernetes', synonyms: ['K8s'] },
            { term: 'aws services' },
            { term: 'Ci/Cd' },
          ],
          low: [],
        },
      }),
      { ...POSTING, text: `${POSTING.text}\nWe deploy on K8s.` },
      DETERMINISTIC,
    );
    expect(terms(finished.keywords.high)).toEqual(['TypeScript', 'Node.js', 'Kubernetes', 'AWS services', 'CI/CD']);
    expect(finished.keywords.high[2]).toEqual({ term: 'Kubernetes', synonyms: ['K8s'] });
  });

  it('finds the most frequent spelling, the first on a tie', () => {
    expect(postingSpelling('kubernetes', 'Kubernetes and kubernetes and Kubernetes')).toBe('Kubernetes');
    expect(postingSpelling('react', 'REACT, then React')).toBe('REACT');
    expect(postingSpelling('machine learning', 'Machine\n learning at scale')).toBe('Machine learning');
    expect(postingSpelling('Go', 'go to market with Go')).toBe('Go');
    expect(postingSpelling('Rust', 'We use Go')).toBeNull();
    expect(inPostingCase({ high: [{ term: 'Aws Services', synonyms: ['aws services'] }], low: [] }, 'Run AWS services').high).toEqual([
      { term: 'AWS services', synonyms: [] },
    ]);
  });

  it('labels the deterministic analysis\'s keywords as the posting writes them too', () => {
    const html = POSTING.text
      .split('\n')
      .map((line) => (line.startsWith('- ') ? `<li>${line.slice(2)}</li>` : `<h3>${line}</h3>`))
      .join('');
    const analysis = analyzeDeterministic({ title: POSTING.title, html, text: POSTING.text });
    const all = terms([...analysis.keywords.high, ...analysis.keywords.low]);
    expect(all).toContain('AWS services');
    expect(all).not.toContain('Aws Services');
  });
});

// -------------------------------------------------------------------------------------- the fake CLI's answer

const QA_POSTING = `<h3>About the role</h3><p>We are investing in test automation across the whole delivery pipeline.</p>
<h3>Responsibilities</h3><ul><li>Track quality metrics and share them with the team</li>
<li>Write API tests and contract tests for backend services</li><li>Build automated end-to-end tests with Playwright and Cypress</li></ul>
<h3>Requirements</h3><ul><li>1-2 years of experience in test automation or software engineering</li>
<li>Experience with Playwright, Cypress or Selenium</li><li>Programming skills in TypeScript, JavaScript or Python</li></ul>
<h3>Nice to have</h3><ul><li>Experience with Jest</li></ul>
<h3>Benefits</h3><ul><li>Flexible paid time off</li></ul>
<h3>About Ironvale Robotics</h3><p>Ironvale Robotics builds warehouse robots.</p>
<p>Base salary: $94,000 - $112,000 per year.</p>`;

async function fakeAnswer(user: string) {
  const script = join(repoRoot(), 'tools', 'fake-claude', 'scenarios', 'job_analysis.mjs');
  const module = (await import(pathToFileURL(script).href)) as { default: (ctx: { user: string }) => unknown };
  return JobAnalysisOutputSchema.parse(module.default({ user }));
}

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('the fake CLI reads the posting it is given', () => {
  it("answers the posting's own bullets and terms, plus a few things the grounding must drop", async () => {
    const text = [
      'Responsibilities',
      '- Build automated end-to-end tests with Playwright and Cypress',
      'Requirements',
      '- 1-2 years of experience in test automation',
      '- Programming skills in TypeScript or Python',
      'About Acme',
      '- Acme makes robots',
    ].join('\n');
    const prompt = jobAnalysisPrompt.user({ title: 'Junior QA Engineer', company: 'Acme', locations: 'Pittsburgh, PA', description: text });
    const answer = await fakeAnswer(prompt);
    expect(answer.summary.responsibilities).toEqual(['Build automated end-to-end tests with Playwright and Cypress']);
    expect(answer.summary.requirements.slice(0, 2)).toEqual(['1-2 years of experience in test automation', 'Programming skills in TypeScript or Python']);
    expect(answer.keywords.high.map((group) => group.term)).toEqual(['Python', 'TypeScript', 'Sumerian cuneiform']);
    expect(answer.keywords.low.map((group) => group.term)).toEqual(['Playwright', 'Cypress', 'Python']);
    expect(answer).toMatchObject({ experienceLevels: ['junior'], minYears: 1, category: null });

    const finished = finishAiAnalysis(answer, { title: 'Junior QA Engineer', text }, { requirements: [], responsibilities: [], desired: [] });
    expect(finished.requirements).toEqual(['1-2 years of experience in test automation', 'Programming skills in TypeScript or Python']);
    expect(terms(finished.keywords.high)).toEqual(['Python', 'TypeScript']);
    expect(terms(finished.keywords.low)).toEqual(['Playwright', 'Cypress']);
    expect(finished.facts.salary).toBeNull();
  });

  it('gives each job its own analysis through the AI queue', async () => {
    ctx = createTestContext();
    const source = insertSource(ctx.deps.db, { kind: 'greenhouse', name: 'ironvale', config: {} }, TEST_NOW.toISOString());
    const ingest = createIngestService(ctx.deps, {
      adapters: {
        greenhouse: {
          kind: 'greenhouse',
          fetch: async () => ({
            postings: [
              {
                sourceJobId: 'qa-1',
                title: 'Junior QA Engineer',
                company: { name: 'Ironvale Robotics' },
                descriptionHtml: QA_POSTING,
                url: 'https://jobs.example.com/ironvale/qa-1',
                locations: ['Pittsburgh, PA'],
              },
            ],
            complete: true,
            failures: [],
          }),
        },
      },
    });
    await ingest.run(source.id, 'manual').done;
    const service = ctx.deps.services.jobAnalysis as JobAnalysisServiceInternals;
    const job = ctx.deps.db.prepare('SELECT id FROM jobs').get() as { id: number };
    expect(service.ensure(job.id, { interactive: true })!.refining).toBe(true);
    const task = ctx.deps.db.prepare("SELECT id FROM ai_tasks WHERE kind = 'job_analysis'").get() as { id: string };
    expect((await requireAi(ctx.deps).waitFor(task.id)).status).toBe('succeeded');

    const { analysis } = service.get(job.id)!;
    expect(analysis.source).toBe('ai');
    expect(analysis.requirements).toEqual([
      '1-2 years of experience in test automation or software engineering',
      'Experience with Playwright, Cypress or Selenium',
      'Programming skills in TypeScript, JavaScript or Python',
    ]);
    expect(analysis.responsibilities).toContain('Build automated end-to-end tests with Playwright and Cypress');
    expect(analysis.desired).toEqual(['Experience with Jest']);
    const all = terms([...analysis.keywords.high, ...analysis.keywords.low]);
    expect(all).toEqual(expect.arrayContaining(['Playwright', 'Cypress', 'Selenium', 'TypeScript', 'JavaScript', 'Python', 'Jest']));
    expect(all.join(' ')).not.toMatch(/Sumerian|Kubernetes|Terraform/);
    expect(analysis.experienceLevels).toEqual(['junior']);
    expect(analysis.categoryId).toBe('qa-testing');
    // The stated pay stays; the fake's made-up figure never lands.
    const row = ctx.deps.db.prepare('SELECT salary_min, salary_max FROM jobs WHERE id = ?').get(job.id) as Record<string, number>;
    expect(row).toEqual({ salary_min: 94000, salary_max: 112000 });
  });
});
