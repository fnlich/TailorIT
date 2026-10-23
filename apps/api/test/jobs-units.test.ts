import { describe, expect, it } from 'vitest';
import { conformKeywords, extractSections, sectionOfHeading } from '../src/features/jobs/analysis';
import { decodeCursor, encodeCursor } from '../src/features/jobs/cursor';
import { MAX_SEARCH_WORDS, buildFtsQuery, searchWords } from '../src/features/jobs/fts';
import { sanitizeDescription } from '../src/features/jobs/html';
import { companyLinksOf, isoDay, isoTimestamp, logoUrlOf } from '../src/features/jobs/rows';

// Work package J2: the pure pieces of the Jobs API.

describe('buildFtsQuery', () => {
  const columns = '{title company_name locations_text}';

  it('quotes every word, matches words of 3+ letters (and the last from 2) as prefixes, in title, company and places only', () => {
    expect(buildFtsQuery('Senior data eng')).toBe(`${columns} : ("senior"* "data"* "eng"*)`);
    expect(buildFtsQuery('  kubernetes  ')).toBe(`${columns} : ("kubernetes"*)`);
  });

  it('keeps multi-token words as phrases and drops punctuation', () => {
    expect(buildFtsQuery('Node.js C++')).toBe(`${columns} : ("node js" "c")`);
    expect(buildFtsQuery('Montréal')).toBe(`${columns} : ("montreal"*)`);
  });

  it('turns operators, quotes and column syntax into plain words', () => {
    expect(buildFtsQuery('NOT "x" OR title:yaml')).toBe(`${columns} : ("not"* "x" "or" "title yaml"*)`);
    expect(buildFtsQuery('NEAR(ab cd)*')).toBe(`${columns} : ("near ab" "cd"*)`);
  });

  it('is null without a searchable word, and caps the words', () => {
    expect(buildFtsQuery('')).toBeNull();
    expect(buildFtsQuery('  +++ *** "" ')).toBeNull();
    expect(buildFtsQuery(undefined)).toBeNull();
    const many = Array.from({ length: 15 }, (_, index) => `w${index}`).join(' ');
    expect(searchWords(many)).toHaveLength(MAX_SEARCH_WORDS);
  });

  it('does not prefix a single character, nor a two-letter word before the last', () => {
    expect(buildFtsQuery('go dev')).toBe(`${columns} : ("go" "dev"*)`);
    expect(buildFtsQuery('dev go')).toBe(`${columns} : ("dev"* "go"*)`);
    expect(buildFtsQuery('engineer c')).toBe(`${columns} : ("engineer"* "c")`);
  });
});

describe('job list cursors', () => {
  it('round-trips and refuses another ordering', () => {
    const cursor = encodeCursor({ mode: 'posted', key: '2026-10-01T00:00:00.000Z', id: 42 });
    expect(decodeCursor(cursor, 'posted')).toEqual({ mode: 'posted', key: '2026-10-01T00:00:00.000Z', id: 42 });
    expect(decodeCursor(cursor, 'salary')).toBeNull();
    const rank = encodeCursor({ mode: 'rank', key: -0.000012345678901234, id: 7 });
    expect(decodeCursor(rank, 'rank')).toEqual({ mode: 'rank', key: -0.000012345678901234, id: 7 });
  });

  it('refuses garbage and wrong types', () => {
    expect(decodeCursor('', 'posted')).toBeNull();
    expect(decodeCursor('%%%', 'posted')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,"posted",5,1]').toString('base64url'), 'posted')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,"salary","x",1]').toString('base64url'), 'salary')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,"posted","2026",0]').toString('base64url'), 'posted')).toBeNull();
    expect(decodeCursor(Buffer.from('[2,"posted","2026",1]').toString('base64url'), 'posted')).toBeNull();
  });
});

describe('extractSections (the fallback analysis summary)', () => {
  it('reads headings, bold-only paragraphs and "Heading:" lines with the bullets under them', () => {
    const html = `
      <h2>About us</h2><ul><li>We are great.</li></ul>
      <h3>Your Responsibilities</h3><ul><li>Ship features.</li><li>Review code &amp; mentor.</li></ul>
      <p><b>Minimum Qualifications:</b></p><ul><li>3+ years of TypeScript.</li></ul>
      <p>Preferred Qualifications:</p><ul><li>GraphQL.</li></ul>
      <h3>Benefits</h3><ul><li>Health insurance.</li></ul>`;
    expect(extractSections(html)).toEqual({
      requirements: ['3+ years of TypeScript.'],
      responsibilities: ['Ship features.', 'Review code & mentor.'],
      desired: ['GraphQL.'],
    });
  });

  it('reads plain-text postings', () => {
    const text = 'What you will do:\n- Build APIs\n- Write tests\nRequirements:\n• Go\n• SQL\nNice to have:\n* Kafka';
    expect(extractSections('', text)).toEqual({
      requirements: ['Go', 'SQL'],
      responsibilities: ['Build APIs', 'Write tests'],
      desired: ['Kafka'],
    });
  });

  it('classifies headings', () => {
    expect(sectionOfHeading('Preferred Qualifications')).toBe('desired');
    expect(sectionOfHeading("What you'll need")).toBe('requirements');
    expect(sectionOfHeading('What You’ll Do')).toBe('responsibilities');
    expect(sectionOfHeading('Perks & Benefits')).toBeNull();
  });
});

describe('conformKeywords', () => {
  it('keeps valid groups and repairs the rest instead of dropping everything', () => {
    const many = Array.from({ length: 30 }, (_, index) => `alias ${index}`);
    expect(
      conformKeywords({
        high: [{ term: ' Kubernetes ', synonyms: ['k8s', 'k8s', 7, '', 'Kubernetes', ...many] }, { term: '' }, 'Docker', { term: 'x'.repeat(200) }],
        low: 'not a list',
      }),
    ).toEqual({
      high: [
        { term: 'Kubernetes', synonyms: ['k8s', ...many.slice(0, 19)] },
        { term: 'Docker', synonyms: [] },
      ],
      low: [],
    });
    const valid = { high: [{ term: 'Go', synonyms: ['Golang'] }], low: [] };
    expect(conformKeywords(valid)).toEqual(valid);
    expect(conformKeywords(null)).toEqual({ high: [], low: [] });
  });
});

describe('row helpers', () => {
  it('normalizes stored times and days', () => {
    expect(isoTimestamp('2026-10-22')).toBe('2026-10-22T00:00:00.000Z');
    expect(isoTimestamp('2026-10-22T12:00:00Z')).toBe('2026-10-22T12:00:00.000Z');
    expect(isoTimestamp('nope')).toBeNull();
    expect(isoDay('2026-10-22T23:00:00.000Z')).toBe('2026-10-22');
    expect(isoDay(null)).toBeNull();
  });

  it('keeps only logos and links a browser can open', () => {
    expect(logoUrlOf('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(logoUrlOf('/static/logos/a.png')).toBe('/static/logos/a.png');
    expect(logoUrlOf('//evil.example/a.png')).toBeNull();
    expect(logoUrlOf('C:\\logos\\a.png')).toBeNull();
    expect(companyLinksOf('[{"label":"Site","url":"https://a.example"},"https://www.linkedin.com/company/a","ftp://x",5]')).toEqual([
      { label: 'Site', url: 'https://a.example' },
      { label: 'LinkedIn', url: 'https://www.linkedin.com/company/a' },
    ]);
    expect(companyLinksOf('not json')).toEqual([]);
  });

  it('sanitizes posting HTML to structure and safe links', () => {
    const html = sanitizeDescription(
      '<div style="color:red" class="x"><h2 id="a">Role</h2><iframe src="https://x"></iframe><a href="https://ok.example">ok</a><a href="data:text/html,x">bad</a></div>',
    );
    expect(html).toBe(
      '<div><h2>Role</h2><a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">ok</a><a target="_blank" rel="noopener noreferrer nofollow">bad</a></div>',
    );
    expect(sanitizeDescription(null)).toBe('');
  });
});
