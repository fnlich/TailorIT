import { describe, expect, it } from 'vitest';
import {
  categorizeTitle,
  inferEmploymentType,
  inferExperienceLevels,
  inferLeadership,
  inferMinYears,
  inferRequiredYears,
  inferStatedYears,
  inferWorkArrangement,
  levelsForYears,
} from './infer';

describe('inferExperienceLevels', () => {
  it.each([
    ['Software Engineering Intern', '3+ years of coursework experience', ['entry']],
    ['New Grad Software Engineer', '', ['entry']],
    ['Junior Developer', '', ['junior']],
    ['Senior Software Engineer', '', ['senior']],
    ['Sr. Data Engineer', '', ['senior']],
    ['Staff Engineer', '', ['expert']],
    ['Principal Product Designer', '', ['expert']],
    ['Software Engineer II', '', ['junior', 'mid']],
    ['Software Engineer III', '', ['senior']],
    ['Associate Product Manager', '', ['junior']],
    ['Associate Director, Engineering', '', ['expert']],
    ['Staff Accountant', '', []],
    ['Software Engineer', 'You have 5+ years of experience building APIs.', ['senior']],
    ['Software Engineer', 'At least 2 years of professional experience.', ['junior']],
    ['Software Engineer', '3-5 years of experience with Python.', ['mid']],
    ['Software Engineer', '1-3 years experience', ['entry', 'junior']],
    ['Backend Engineer', 'Eight years of industry experience', ['expert']],
    ['Senior Engineer', '3+ years of Go', ['mid', 'senior']],
    ['Software Engineer', 'The company was founded 10 years ago.', []],
    ['Product Manager', '', []],
  ])('%s / %s', (title, text, expected) => {
    expect(inferExperienceLevels(title, text)).toEqual(expected);
  });

  it('reads the smallest stated minimum', () => {
    expect(inferMinYears('7+ years of backend work, including 3+ years leading teams')).toBe(3);
    expect(inferMinYears('No experience needed')).toBeNull();
  });

  it('maps year bands, ranges as [from, to)', () => {
    expect(levelsForYears(0)).toEqual(['entry']);
    expect(levelsForYears(2)).toEqual(['junior']);
    expect(levelsForYears(4)).toEqual(['mid']);
    expect(levelsForYears(7)).toEqual(['senior']);
    expect(levelsForYears(12)).toEqual(['expert']);
    expect(levelsForYears(2, 5)).toEqual(['junior', 'mid']);
    expect(levelsForYears(5, 10)).toEqual(['senior', 'expert']);
  });
});

describe('inferEmploymentType', () => {
  it.each([
    ['Software Engineering Intern', '', 'internship'],
    ['Co-op Student, Data', '', 'internship'],
    ['Part-Time Barista', '', 'part_time'],
    ['Contract Frontend Developer', '', 'contract'],
    ['Freelance Designer', '', 'contract'],
    ['Software Engineer (Full-Time)', '', 'full_time'],
    ['Software Engineer', 'Employment type: Contract. We build things.', 'contract'],
    ['Software Engineer', 'This is a full-time, permanent role.', 'full_time'],
    ['Data Analyst', 'This position is a part-time role with flexible hours.', 'part_time'],
    ['Software Engineer', 'Join us! We run a summer internship program too.', 'internship'],
    ['Software Engineer', 'We build payments infrastructure.', null],
  ])('%s / %s -> %s', (title, text, expected) => {
    expect(inferEmploymentType(title, text)).toBe(expected);
  });
});

describe('inferWorkArrangement', () => {
  it.each([
    ['This role is hybrid, three days a week in the office.', null, 'hybrid'],
    ['2 days per week in the office, the rest remote.', null, 'hybrid'],
    ['This is a fully remote position.', null, 'remote'],
    ['You can work from home anywhere in the US.', null, 'remote'],
    ['This role is not remote; you will work on-site in Austin.', null, 'onsite'],
    ['You will work in-office with the team.', null, 'onsite'],
    ['We build great software.', null, null],
    ['We build great software.', 'Remote - US', 'remote'],
    ['Fully remote team.', 'Hybrid - New York, NY', 'hybrid'],
  ])('%s', (text, location, expected) => {
    expect(inferWorkArrangement(text, location)).toBe(expected);
  });
});

describe('inferWorkArrangement, strict description reading', () => {
  const strict = (text: string, location: string | null = null) => inferWorkArrangement(text, location, { strict: true });

  it.each([
    ['This role is hybrid, three days a week in the office.', null, 'hybrid'],
    ['2 days per week in the office, the rest remote.', null, 'hybrid'],
    ['This is a fully remote position.', null, 'remote'],
    ['You can work from home anywhere in the US.', null, 'remote'],
    ['This role is not remote; you will work on-site in Austin.', null, 'onsite'],
    ['You will work in-office with the team.', null, 'onsite'],
    ['We build great software.', null, null],
    ['We build great software.', 'Remote - US', 'remote'],
    ['Fully remote team.', 'Hybrid - New York, NY', 'hybrid'],
  ])('keeps the existing case: %s', (text, location, expected) => {
    expect(strict(text, location)).toBe(expected);
  });

  it.each([
    // Hybrid with work context, read before "not remote".
    ['This is a hybrid role, not a remote role.', 'hybrid'],
    ['We offer a hybrid work schedule.', 'hybrid'],
    ['Hybrid working policy for the London office.', 'hybrid'],
    ['This position is hybrid.', 'hybrid'],
    ['Hybrid (3 days in office)', 'hybrid'],
    ['Hybrid - 2 days onsite', 'hybrid'],
    ['Hybrid: three days a week', 'hybrid'],
    ['Work arrangement: Hybrid', 'hybrid'],
    ['Workplace type: Hybrid', 'hybrid'],
    ['We are partially remote.', 'hybrid'],
    ['A mix of remote and in-office work.', 'hybrid'],
    // "Hybrid" that names a technology.
    ['Build a hybrid cloud platform.', null],
    ['Experience with hybrid-cloud networking.', null],
    ['Operate hybrid (on-prem/AWS) deployments.', null],
    ['Ship a hybrid mobile app.', null],
    ['We use a hybrid model of agile and waterfall.', null],
    ['Hybrid multi-cloud infrastructure', null],
    ['A hybrid environment of Linux and Windows', null],
    ['Work model: hybrid cloud', null],
    ['Hybrid architecture and hybrid apps; a hybrid approach to hybrid deployment.', null],
    // Strong remote statements.
    ['This is a remote position.', 'remote'],
    ['This is a fully remote opportunity.', 'remote'],
    ['A remote-eligible role', 'remote'],
    ['We are a remote-first company.', 'remote'],
    ['Our team is remote friendly.', 'remote'],
    ['The role is remote.', 'remote'],
    ['You will work remotely.', 'remote'],
    ['Remote (US)', 'remote'],
    ['Remote - Canada', 'remote'],
    ['Location: Remote', 'remote'],
    ['WFH available', 'remote'],
    ['A fully distributed team', 'remote'],
    ['Telecommuting is supported.', 'remote'],
    ['100% remote', 'remote'],
    // Words about something else.
    ['Remote monitoring of devices.', null],
    ['Collaborate with remote teams across time zones.', null],
    ['Remote debugging of embedded targets.', null],
    ['On-site interviews in Austin.', null],
    ['An in-person interview is part of the process.', null],
    // Strong on-site statements.
    ['This role is on-site.', 'onsite'],
    ['On-site only.', 'onsite'],
    ['You will work in the office every day.', 'onsite'],
    ['Five days a week in the office.', 'onsite'],
    ['Workplace type: On-site', 'onsite'],
    // A conflict, or "not remote" alone, is not sure.
    ['Fully remote. You will work on-site daily.', null],
    ['Remote work is not available.', null],
    ['This position is not remote.', null],
    ['Not remote: you will work on-site in Austin.', 'onsite'],
  ])('%s -> %s', (text, expected) => {
    expect(strict(text)).toBe(expected);
  });

  it('leaves the default reading as it was', () => {
    expect(inferWorkArrangement('Build a hybrid cloud platform.', null)).toBe('hybrid');
    expect(inferWorkArrangement('This position is not remote.', null)).toBe('onsite');
    expect(inferWorkArrangement('Remote monitoring of devices.', null)).toBe('remote');
  });
});

describe('inferRequiredYears', () => {
  it.each([
    ['7+ years of backend work, including 3+ years leading teams', 7],
    ['Minimum 2 years of experience; ideally 5+ years of professional experience', 2],
    ['2+ years of Python and 5+ years of software development experience', 5],
    ['5+ years in a similar role', 5],
    ['3+ years of people management experience', 3],
    ['3+ years leading teams and 2+ years of Go', 3],
    ['No experience needed', null],
    ['Enjoy 5 days PTO', null],
    ['', null],
  ])('%s -> %s', (text, expected) => {
    expect(inferRequiredYears(text)).toBe(expected);
  });

  it('keeps inferMinYears on the fewest years', () => {
    expect(inferMinYears('7+ years of backend work, including 3+ years leading teams')).toBe(3);
  });

  it('stays fast on long runs of spaces', () => {
    const started = Date.now();
    expect(inferMinYears(`at least${' '.repeat(60_000)}5 years`)).toBe(5);
    expect(inferRequiredYears(`5${' '.repeat(60_000)}+ years of experience`)).toBe(5);
    expect(inferStatedYears(' '.repeat(60_000))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('inferStatedYears', () => {
  it.each([
    ['Engineer with 12+ years of experience; 5 years at Google', 12],
    ['Over 35 years of industry experience', 35],
    ['8-10 years of experience in fintech', 8],
    ['The company was founded 10 years ago.', null],
    ['', null],
  ])('%s -> %s', (text, expected) => {
    expect(inferStatedYears(text)).toBe(expected);
  });
});

describe('inferLeadership', () => {
  it.each([
    ['Engineering Manager', 'manager'],
    ['Director of Engineering', 'manager'],
    ['VP, Product', 'manager'],
    ['Product Manager', 'ic'],
    ['Technical Program Manager', 'ic'],
    ['Senior Software Engineer', 'ic'],
  ])('%s -> %s', (title, expected) => {
    expect(inferLeadership(title)).toBe(expected);
  });
});

describe('categorizeTitle', () => {
  it.each([
    ['Site Reliability Engineer', 'devops-infrastructure', ['site-reliability-engineering']],
    ['Senior SRE', 'devops-infrastructure', ['site-reliability-engineering']],
    ['DevOps Engineer', 'devops-infrastructure', ['devops']],
    ['Platform Engineer', 'devops-infrastructure', ['platform-engineering']],
    ['Senior Software Engineer, Backend', 'software-engineering', ['backend']],
    ['Frontend / Mobile Engineer', 'software-engineering', ['frontend', 'mobile']],
    ['Full Stack Developer', 'software-engineering', ['full-stack']],
    ['iOS Engineer', 'software-engineering', ['mobile']],
    ['Software Engineer', 'software-engineering', []],
    ['Machine Learning Engineer', 'ai-ml', ['ml-engineering']],
    ['Software Engineer, Machine Learning', 'ai-ml', ['ml-engineering']],
    ['Data Engineer', 'data-analytics', ['data-engineering']],
    ['Data Scientist', 'data-analytics', ['data-science']],
    ['Data Analyst, Finance', 'data-analytics', ['data-analysis']],
    ['Analytics Engineer', 'data-analytics', ['analytics-engineering']],
    ['QA Automation Engineer', 'qa-testing', ['test-automation']],
    ['ML Engineer, Computer Vision', 'ai-ml', ['applied-ml']],
    ['Security Engineer', 'security', []],
    ['Application Security Engineer', 'security', ['application-security']],
    ['QA Engineer', 'qa-testing', ['manual-qa']],
    ['SDET', 'qa-testing', ['test-automation']],
    ['Product Manager, AI', 'product', ['product-management']],
    ['Product Designer', 'design', ['product-design']],
    ['Engineering Manager, Platform', 'engineering-management', ['engineering-leadership']],
    ['Technical Program Manager', 'engineering-management', ['program-management']],
    ['Technical Recruiter', 'people-hr', ['recruiting']],
    ['Account Executive', 'sales-solutions', ['account-executive']],
    ['Solutions Engineer', 'sales-solutions', ['solutions-engineering']],
    ['Customer Success Manager', 'customer-success', ['customer-success-management']],
    ['IT Support Specialist', 'it-support', ['help-desk']],
    ['Senior Accountant', 'finance', ['accounting']],
    ['Corporate Counsel', 'legal', ['legal-counsel']],
    ['Growth Marketing Manager', 'marketing', ['growth-marketing']],
    ['Developer Advocate', 'marketing', ['developer-relations']],
    ['Mechanical Engineer', 'other', []],
  ])('%s', (title, category, subcategories) => {
    expect(categorizeTitle(title)).toEqual({ categoryId: category, subcategoryIds: subcategories });
  });
});
