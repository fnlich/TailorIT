import { describe, expect, it } from 'vitest';
import { analyzeDeterministic } from '../src/features/job-analysis/deterministic';
import { classifyHeading, extractSections, sectionsOfLists } from '../src/features/job-analysis/sections';
import { sanitizeDescription, textToHtml } from '../src/features/ingest/html';
import { parseJsonLenient, retryAfterMs } from '../src/features/ingest/http';
import {
  contentHashOf,
  inferClearance,
  inferDegree,
  inferSponsorship,
  isoOrNull,
  NORMALIZE_VERSION,
  normalizePosting,
  salaryFromText,
  sha256,
  sourceHashOf,
  stableStringify,
} from '../src/features/ingest/normalize';
import { guessMapping, parseCsv, rowToPosting, tableFromCsv, tableFromJson } from '../src/features/ingest/tabular';
import type { RawPosting } from '../src/features/ingest/types';

const POSTING_HTML = `
<div class="content-intro"><p>Acme builds tools for builders.</p></div>
<h2>What you’ll do</h2>
<ul><li>Design and build backend services in Go</li><li>Own CI/CD pipelines and deployment tooling</li></ul>
<h2>What you’ll bring</h2>
<ul><li>5+ years of experience building backend services</li><li>Hands-on experience with Kubernetes and Terraform</li></ul>
<p><strong>Nice to have</strong></p>
<ul><li>Experience with AWS</li></ul>
<h4><strong>How Acme Supports Full-Time Employees</strong></h4>
<ul><li>Flexible paid time off</li></ul>`;

function raw(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    sourceJobId: '1',
    title: 'Senior Platform Engineer',
    company: { name: 'Acme, Inc.' },
    descriptionHtml: POSTING_HTML,
    url: 'https://boards.example.com/acme/jobs/1?utm_source=x',
    locations: ['San Francisco, CA; Remote - US'],
    ...overrides,
  };
}

describe('section extraction', () => {
  it('classifies the usual headings', () => {
    expect(classifyHeading('What you’ll bring')).toBe('requirements');
    expect(classifyHeading("What you'll do")).toBe('responsibilities');
    expect(classifyHeading('Preferred Qualifications')).toBe('desired');
    expect(classifyHeading('Basic Qualifications')).toBe('requirements');
    expect(classifyHeading('Core Responsiblities')).toBe('responsibilities');
    expect(classifyHeading('What We Value')).toBe('desired');
    expect(classifyHeading('What We Require')).toBe('requirements');
    expect(classifyHeading('About Us')).toBeNull();
    expect(classifyHeading('Benefits')).toBeNull();
    expect(classifyHeading('How GitLab Supports Full-Time Employees')).toBeNull();
    expect(classifyHeading('About you')).toBe('requirements');
  });

  it('reads headings, bold paragraphs and their lists from HTML', () => {
    const sections = extractSections(POSTING_HTML);
    expect(sections.responsibilities).toEqual(['Design and build backend services in Go', 'Own CI/CD pipelines and deployment tooling']);
    expect(sections.requirements).toEqual([
      '5+ years of experience building backend services',
      'Hands-on experience with Kubernetes and Terraform',
    ]);
    expect(sections.desired).toEqual(['Experience with AWS']);
  });

  it('reads plain text with "Heading:" lines and bullets, and leaves item-like lines as items', () => {
    const text = [
      'About the job',
      'We are hiring.',
      '',
      'Responsibilities:',
      '• Build data pipelines',
      '• Keep dashboards fresh',
      '',
      'Requirements',
      'Experience with SQL',
      '3+ years of Python',
      '',
      'We are an equal opportunity employer and value diversity at our company in every way we can think of, ' +
        'which is a long sentence that is not a bullet at all and keeps going for quite a while longer than that.',
    ].join('\n');
    const sections = extractSections('', text);
    expect(sections.responsibilities).toEqual(['Build data pipelines', 'Keep dashboards fresh']);
    expect(sections.requirements).toEqual(['Experience with SQL', '3+ years of Python']);
  });

  it('turns Lever lists into sections; an unnamed first list is the role\'s work', () => {
    const sections = sectionsOfLists([
      { heading: 'Administrative Business Partner (Foundry)', items: ['Provide support', 'Book travel'] },
      { heading: 'What We Value', items: ['Discretion'] },
      { heading: 'What We Require', items: ['Two years of experience'] },
    ]);
    expect(sections).toEqual({
      responsibilities: ['Provide support', 'Book travel'],
      desired: ['Discretion'],
      requirements: ['Two years of experience'],
    });
  });

  it('keeps "1.5 years" whole when tidying bullets', () => {
    const sections = extractSections('<h3>Requirements</h3><ul><li>1.5 years of SQL</li><li>- Python</li></ul>');
    expect(sections.requirements).toEqual(['1.5 years of SQL', 'Python']);
  });
});

describe('deterministic analysis', () => {
  it('extracts keywords, levels, years, leadership and category', () => {
    const html = sanitizeDescription(POSTING_HTML);
    const analysis = analyzeDeterministic({ title: 'Senior Platform Engineer', html, text: htmlText(html) });
    const terms = [...analysis.keywords.high, ...analysis.keywords.low].map((group) => group.term);
    expect(terms).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'Go']));
    expect(analysis.experienceLevels).toEqual(['senior']);
    expect(analysis.minYears).toBe(5);
    expect(analysis.leadership).toBe('ic');
    expect(analysis.categoryId).toBe('devops-infrastructure');
    expect(analysis.subcategoryIds).toEqual(['platform-engineering']);
  });

  it("reads the posting's facets from its sections: soft skills, certifications and industries, required years", () => {
    const html = sanitizeDescription(
      '<p>We are a fintech company and value belonging.</p>' +
        '<h3>Requirements</h3><ul><li>7+ years of backend experience, including 3+ years leading teams</li>' +
        '<li>Strong communication skills and collaboration with product</li><li>CKA certification preferred</li></ul>' +
        '<h3>Responsibilities</h3><ul><li>Mentoring engineers on the healthcare platform</li></ul>' +
        '<h3>Benefits</h3><ul><li>Medical, dental and vision; 5 days PTO</li></ul>',
    );
    const analysis = analyzeDeterministic({ title: 'Backend Engineer', html, text: htmlText(html) });
    expect(analysis.softSkills).toEqual(['Communication', 'Collaboration', 'Mentoring']);
    // "fintech" is in the about-us line, outside the sections: an industry the sections name counts.
    expect(analysis.terms).toEqual({ certifications: ['Certified Kubernetes Administrator (CKA)'], domains: ['healthcare'] });
    // The general requirement, not the leading years (inferMinYears, which sets the levels, still reads 3).
    expect(analysis.requiredYears).toBe(7);
    expect(analysis.minYears).toBe(3);

    const plain = analyzeDeterministic({ title: 'Analyst', html: '', text: 'You bring 2+ years of experience with SQL and strong attention to detail.' });
    expect(plain).toMatchObject({ softSkills: ['Attention to detail'], requiredYears: 2 });
  });
});

function htmlText(html: string): string {
  return normalizePosting(raw({ descriptionHtml: html })).descriptionText;
}

describe('normalisation', () => {
  it('sanitizes HTML: no scripts, styles or event handlers; links open safely', () => {
    const html = sanitizeDescription(
      '<h1 style="color:red">Hi</h1><script>alert(1)</script><p onclick="x()">Text <a href="javascript:x()">bad</a> <a href="https://e.com">ok</a></p><p></p>',
    );
    expect(html).toContain('<h2>Hi</h2>');
    expect(html).not.toMatch(/script|onclick|style=|javascript:/);
    expect(html).toContain('<a href="https://e.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
    expect(html).not.toContain('<p></p>');
  });

  it('turns plain text into paragraphs and lists', () => {
    expect(textToHtml('Requirements:\n- SQL\n- Python\n\nThanks')).toBe(
      '<p>Requirements:</p>\n<ul><li>SQL</li><li>Python</li></ul>\n<p>Thanks</p>',
    );
  });

  it('normalises a posting: company key, link key, hash, places, arrangement, type, levels, category', () => {
    const posting = normalizePosting(raw());
    expect(posting.company.name).toBe('Acme, Inc.');
    expect(posting.company.nameKey).toBe('acme');
    expect(posting.linkKey).toBe('https://boards.example.com/acme/jobs/1');
    expect(posting.contentHash).toBe(contentHashOf(posting.descriptionText));
    expect(posting.locations.map((place) => [place.city, place.region, place.countryCode, place.isRemote])).toEqual([
      ['San Francisco', 'CA', 'US', false],
      [null, null, 'US', true],
    ]);
    expect(posting.primaryLocation).toBe('San Francisco, CA, USA');
    expect(posting.locationCount).toBe(2);
    expect(posting.locationsText).toBe('San Francisco, CA, USA; Remote in USA');
    expect(posting.workArrangement).toBe('remote');
    expect(posting.employmentType).toBe('full_time');
    expect(posting.experienceLevels).toEqual(['senior']);
    expect(posting.categoryId).toBe('devops-infrastructure');
    expect(posting.descriptionHtml).not.toContain('content-intro');
    expect(posting.salary).toBeNull();
  });

  it('weak description mentions ("remote monitoring", "on-site interviews", "hybrid cloud") now give NULL at ingest', () => {
    const arrangement = (description: string, locations = ['Austin, TX']) =>
      normalizePosting(raw({ locations, descriptionHtml: `<p>${description}</p>` })).workArrangement;
    // Words about something else, which the description reading used to take for the arrangement.
    expect(arrangement('You will build remote monitoring for industrial devices.')).toBeNull();
    expect(arrangement('Our process ends with on-site interviews in Austin.')).toBeNull();
    expect(arrangement('Help us build a hybrid cloud platform for our customers.')).toBeNull();
    expect(arrangement('Collaborate with remote teams across time zones.')).toBeNull();
    expect(arrangement('An in-person interview is part of the process.')).toBeNull();
    // A description that says how the role is worked still does.
    expect(arrangement('This is a hybrid role: three days a week in our Austin office.')).toBe('hybrid');
    expect(arrangement('This position is fully remote within the US.')).toBe('remote');
    expect(arrangement('This role is on-site in Austin.')).toBe('onsite');
    // Unsure (both said, or "not remote" alone): empty.
    expect(arrangement('Fully remote. You will work on-site daily.')).toBeNull();
    expect(arrangement('This position is not remote.')).toBeNull();
    // The location text and a source's arrangement field are read as before.
    expect(arrangement('Remote monitoring of devices.', ['Remote - US'])).toBe('remote');
    expect(arrangement('Hybrid cloud work.', ['Austin, TX (Hybrid)'])).toBe('hybrid');
    expect(normalizePosting(raw({ locations: ['Austin, TX'], arrangementText: 'On-site', descriptionHtml: '<p>Remote monitoring.</p>' })).workArrangement).toBe(
      'onsite',
    );
    expect(normalizePosting(raw({ locations: ['Austin, TX'], workArrangement: 'remote', descriptionHtml: '<p>On-site interviews.</p>' })).workArrangement).toBe(
      'remote',
    );
  });

  it('is normalisation version 2, which every source hash carries (so each posting is rewritten once)', () => {
    expect(NORMALIZE_VERSION).toBe(2);
    const { supplement: _supplement, ...listed } = raw();
    expect(sourceHashOf(raw())).toBe(sha256(`v2\n${stableStringify(listed)}`));
  });

  it('keeps structured fields over inference and fills the country of bare places', () => {
    const posting = normalizePosting(
      raw({
        locations: ['Remote'],
        countryHint: 'CA',
        workArrangement: 'hybrid',
        employmentText: 'Contract',
        experienceLevels: ['mid'],
        categoryId: 'data-analytics',
        subcategoryIds: ['data-engineering', 'frontend'],
        salary: { min: 90000, max: 110000, currency: null, period: 'year' },
      }),
    );
    expect(posting.workArrangement).toBe('hybrid');
    expect(posting.employmentType).toBe('contract');
    expect(posting.experienceLevels).toEqual(['mid']);
    expect(posting.subcategoryIds).toEqual(['data-engineering']);
    expect(posting.primaryLocation).toBe('Remote in Canada');
    expect(posting.salary).toMatchObject({ min: 90000, max: 110000, currency: 'CAD', period: 'year', annualUsdMin: 65700 });
  });

  it('finds a salary stated in the description, never a year count or a 401k', () => {
    expect(salaryFromText('The estimated salary range for this position is $135,000 - $200,000/year. Total comp varies.')).toMatchObject({
      min: 135000,
      max: 200000,
      currency: 'USD',
      period: 'year',
    });
    expect(salaryFromText('5+ years of experience\nWe offer a 401k plan')).toBeNull();
    expect(salaryFromText('Pay range: £45,000 – £55,000 per year')).toMatchObject({ currency: 'GBP', min: 45000 });
  });

  it('marks a missing Greenhouse salary as unknown (kept), and a pay-checked one as checked', () => {
    expect(normalizePosting(raw({ salaryPending: true })).salary).toBeUndefined();
    const checked = normalizePosting(raw({ salaryPending: true, supplement: { salary: null } }));
    expect(checked.salary).toBeNull();
    expect(checked.payChecked).toBe(true);
  });

  it('reads clearance, sponsorship and degree', () => {
    expect(inferClearance('Must hold an active Secret clearance.')).toBe(true);
    expect(inferClearance('No security clearance required.')).toBe(false);
    expect(inferClearance('We value clear communication.')).toBeNull();
    expect(inferSponsorship('We are unable to sponsor visas; candidates must work without sponsorship.')).toBe(false);
    expect(inferSponsorship('Visa sponsorship is available for this role.')).toBe(true);
    expect(inferDegree("A Bachelor's degree in computer science or a related field")).toBe("Bachelor's");
    expect(inferDegree('PhD or Master’s degree preferred')).toBe("Master's");
  });

  it('refuses postings without a title, company or link', () => {
    expect(() => normalizePosting(raw({ title: '  ' }))).toThrow(/no title/);
    expect(() => normalizePosting(raw({ company: { name: '' } }))).toThrow(/no company/);
    expect(() => normalizePosting(raw({ url: 'mailto:jobs@example.com' }))).toThrow(/no link/);
  });

  it('hashes a posting stably and leaves the supplement out', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    const base = raw();
    expect(sourceHashOf(base)).toBe(sourceHashOf({ ...base, supplement: { salary: null } }));
    expect(sourceHashOf(base)).not.toBe(sourceHashOf({ ...base, title: 'Staff Platform Engineer' }));
  });

  it('reads dates leniently', () => {
    expect(isoOrNull('2026-10-01')).toBe('2026-10-01T00:00:00.000Z');
    expect(isoOrNull(1786469891368)).toBe(new Date(1786469891368).toISOString());
    expect(isoOrNull('2026-10-15T15:24:46-04:00')).toBe('2026-10-15T19:24:46.000Z');
    expect(isoOrNull('soon')).toBeNull();
  });
});

describe('lenient JSON and Retry-After', () => {
  it('parses JSON with raw control characters inside strings', () => {
    const text = `{"jobs":[{"title":"A${String.fromCharCode(9)}B","descriptionPlain":"line1${String.fromCharCode(10)}line2${String.fromCharCode(12)}"}]}`;
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseJsonLenient(text) as { jobs: Array<{ title: string; descriptionPlain: string }> };
    expect(parsed.jobs[0]!.title).toBe(`A${String.fromCharCode(9)}B`);
    expect(parsed.jobs[0]!.descriptionPlain).toContain('line2');
    expect(() => parseJsonLenient('<html>')).toThrow();
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('5', 0)).toBe(5000);
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(retryAfterMs(null, 0)).toBeNull();
  });
});

describe('CSV and JSON imports', () => {
  it('parses quoted CSV with commas, quotes, line breaks and a BOM', () => {
    const rows = parseCsv('\ufeffa,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2'],
    ]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it("guesses free_tailor's sheet headers", () => {
    const table = tableFromCsv('Date,NO(DATE),Company,Job Title,Job Link,Job Description\n10/20/2026,1,Acme,Data Engineer,https://acme.example/jobs/9,Build pipelines\n');
    const mapping = guessMapping(table.columns);
    expect(mapping).toMatchObject({
      postedAt: 'Date',
      company: 'Company',
      title: 'Job Title',
      url: 'Job Link',
      description: 'Job Description',
      id: null,
    });
    const result = rowToPosting(table.rows[0]!, mapping, 2);
    expect('posting' in result && result.posting).toMatchObject({
      sourceJobId: 'https://acme.example/jobs/9',
      title: 'Data Engineer',
      company: { name: 'Acme' },
      postedAt: '2026-10-20T00:00:00.000Z',
      descriptionText: 'Build pipelines',
    });
  });

  it('reads JSON arrays and objects holding a list; names rows that are missing a field', () => {
    const table = tableFromJson(JSON.stringify({ jobs: [{ title: 'A', company: { name: 'Acme' }, url: 'https://a.example', remote: 'yes' }] }));
    expect(table.columns).toEqual(['title', 'company', 'url', 'remote']);
    const mapping = guessMapping(table.columns);
    expect(mapping.workArrangement).toBe('remote');
    const result = rowToPosting(table.rows[0]!, mapping, 1);
    expect('posting' in result && result.posting.workArrangement).toBe('remote');
    expect(rowToPosting({ title: '', company: 'x', url: 'y' }, guessMapping(['title', 'company', 'url']), 3)).toEqual({
      error: 'Row 3 has no job title.',
    });
    expect(() => tableFromJson('{"a":1}')).toThrow(/list of jobs/);
  });
});
