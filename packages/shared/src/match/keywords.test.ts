import { describe, expect, it } from 'vitest';
import { compileVocabulary, extractKeywords, matchKeywords, matchResult, noResumeMatch, spellingsOf } from './keywords';
import { levelMatch } from './level';

const VOCAB = [
  'Kubernetes',
  'Docker',
  'Go',
  'Python',
  'CI',
  'CI/CD',
  'C',
  'C++',
  'AWS',
  'Terraform',
  'Express',
  'Spring',
  'GraphQL',
  'PostgreSQL',
  'Postgres',
  'REST',
  'Machine Learning',
  'Node.js',
  'TypeScript',
];

describe('matchKeywords', () => {
  const keywords = {
    high: [
      { term: 'Kubernetes', synonyms: [] },
      { term: 'Go', synonyms: ['Golang'] },
      { term: 'Terraform', synonyms: [] },
    ],
    low: [
      { term: 'GraphQL', synonyms: [] },
      { term: 'K8s', synonyms: [] },
      { term: 'Rust', synonyms: [] },
    ],
  };

  it('puts matched first in high-then-low order, then missing, and skips repeated groups', () => {
    const result = matchKeywords('Ran k8s clusters. Wrote Golang services and GraphQL APIs.', keywords);
    expect(result.matched).toEqual([
      { term: 'Kubernetes', priority: 'high' },
      { term: 'Go', priority: 'high' },
      { term: 'GraphQL', priority: 'low' },
    ]);
    expect(result.missing).toEqual([
      { term: 'Terraform', priority: 'high' },
      { term: 'Rust', priority: 'low' },
    ]);
    expect(result.total).toBe(5);
    expect(result.matchedCount).toBe(3);
    expect(result.percentage).toBe(60);
  });

  it('matches a group by any spelling, including built-in synonyms', () => {
    const result = matchKeywords('Wrote services in JS', { high: [{ term: 'JavaScript', synonyms: [] }], low: [] });
    expect(result.matchedCount).toBe(1);
  });

  it('respects boundaries and case for short terms', () => {
    const result = matchKeywords('going to the gym', { high: [{ term: 'Go', synonyms: [] }], low: [] });
    expect(result.matched).toEqual([]);
    expect(result.percentage).toBe(0);
  });

  it('does not count a clearance as TypeScript', () => {
    const result = matchKeywords('Holds an active TS/SCI clearance', { high: [{ term: 'TS', synonyms: [] }], low: [] });
    expect(result.matchedCount).toBe(0);
  });

  it('answers zero for a posting with no keywords', () => {
    expect(matchKeywords('anything', { high: [], low: [] })).toEqual({
      matched: [],
      missing: [],
      matchedCount: 0,
      total: 0,
      percentage: 0,
    });
  });

  it('wraps the API states', () => {
    expect(matchResult('Go', { high: [{ term: 'Go', synonyms: [] }], low: [] }, 'r1')).toMatchObject({
      state: 'ok',
      resumeId: 'r1',
      percentage: 100,
    });
    expect(noResumeMatch(keywords)).toMatchObject({ state: 'no_resume', matchedCount: 0, total: 5 });
  });

  it('expands spellings with built-in synonyms', () => {
    expect(spellingsOf({ term: 'GCP', synonyms: [] })).toEqual(['GCP', 'Google Cloud Platform', 'Google Cloud']);
  });
});

describe('extractKeywords', () => {
  const posting = [
    'Senior Platform Engineer',
    'We run Kubernetes on AWS and manage infrastructure with Terraform.',
    'Go above and beyond for our customers.',
    'Requirements:',
    '- Go',
    '- Docker, Kubernetes',
    '- Experience with CI/CD pipelines',
    'Nice to have: GraphQL, Express APIs and C++.',
    'Spring is our busiest season.',
  ].join('\n');

  it('splits high and low priority', () => {
    const result = extractKeywords(posting, VOCAB, {
      requirementsText: '- Go\n- Docker, Kubernetes\n- Experience with CI/CD pipelines',
    });
    const high = result.high.map((group) => group.term);
    const low = result.low.map((group) => group.term);
    expect(high).toEqual(['Kubernetes', 'Go', 'Docker', 'CI/CD']);
    expect(low).toEqual(['AWS', 'Terraform', 'GraphQL', 'Express', 'C++']);
  });

  it('lets the longest term claim its span ("CI" inside "CI/CD", "C" inside "C++")', () => {
    const result = extractKeywords('CI/CD and C++ experience', VOCAB);
    const terms = [...result.high, ...result.low].map((group) => group.term);
    expect(terms).toContain('CI/CD');
    expect(terms).toContain('C++');
    expect(terms).not.toContain('CI');
    expect(terms).not.toContain('C');
  });

  it('refuses an everyday word at a sentence start but keeps it as a list item or requirement', () => {
    expect(extractKeywords('Go above and beyond.', VOCAB).low).toEqual([]);
    expect(extractKeywords('Spring is here.', VOCAB).low).toEqual([]);
    expect(extractKeywords('Go is a plus.', VOCAB).low.map((group) => group.term)).toEqual(['Go']);
    expect(extractKeywords('Go, Python', VOCAB).low.map((group) => group.term)).toEqual(['Go', 'Python']);
    expect(extractKeywords('We build in Go daily.', VOCAB).low.map((group) => group.term)).toEqual(['Go']);
  });

  it('reads Title-case names case-sensitively unless they are safe in any case', () => {
    const terms = (text: string) => extractKeywords(text, VOCAB).low.map((group) => group.term);
    expect(terms('express your ideas in spring')).toEqual([]);
    expect(terms('we use docker and python')).toEqual(['Docker', 'Python']);
  });

  it('merges spellings of one thing, labelled by the spelling the posting first uses', () => {
    const result = extractKeywords('Postgres tuning. Also PostgreSQL replication. K8s too.', VOCAB);
    expect(result.high.map((group) => group.term)).toEqual(['Postgres']);
    expect(result.high[0]!.synonyms).toContain('PostgreSQL');
    expect(result.low.map((group) => group.term)).toEqual(['K8s']);
    expect(result.low[0]!.synonyms).toContain('Kubernetes');
  });

  it('reads a title as a name: an everyday word opening it still counts', () => {
    expect(extractKeywords('We are hiring.', VOCAB, { title: 'Go Engineer' }).high.map((group) => group.term)).toEqual(['Go']);
    expect(extractKeywords('Spring', VOCAB, { title: 'Spring Developer' }).high.map((group) => group.term)).toEqual([
      'Spring',
    ]);
  });

  it('stays fast on long blank runs and very long lines', () => {
    const started = Date.now();
    extractKeywords(`${' '.repeat(200_000)}. Go above`, VOCAB);
    extractKeywords('x. Go '.repeat(33_334), VOCAB);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('marks a keyword in the title high and caps both lists', () => {
    const result = extractKeywords('Python and Docker.', VOCAB, { title: 'Python Engineer', maxLow: 0 });
    expect(result.high.map((group) => group.term)).toEqual(['Python']);
    expect(result.low).toEqual([]);
  });

  it('accepts a precompiled vocabulary and entries with aliases', () => {
    const compiled = compileVocabulary([{ term: 'Amazon Redshift', aliases: ['Redshift'] }]);
    const result = extractKeywords('Redshift warehouse', compiled);
    expect(result.low).toEqual([{ term: 'Redshift', synonyms: ['Amazon Redshift'] }]);
  });

  it('never extracts one-character terms', () => {
    expect(extractKeywords('C and R', ['C', 'R']).low).toEqual([]);
  });
});

describe('levelMatch', () => {
  it('matches on any overlap with Simplify copy', () => {
    const result = levelMatch(['senior', 'expert'], ['senior']);
    expect(result.state).toBe('match');
    expect(result.lines).toEqual(['Your experience level matches one of the following: Senior, Expert']);
    expect(result.matchingLabels).toEqual(['Senior']);
  });

  it('explains a mismatch', () => {
    const result = levelMatch(['senior'], ['mid', 'junior']);
    expect(result.state).toBe('mismatch');
    expect(result.lines).toEqual([
      'This job asks for: Senior',
      "You're looking for: Junior, Mid",
      'You can still be a good fit — employers often consider adjacent experience levels.',
    ]);
  });

  it('shows nothing without preferences or without job levels', () => {
    expect(levelMatch(['senior'], []).state).toBe('none');
    expect(levelMatch([], ['senior']).state).toBe('none');
  });
});
