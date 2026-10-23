import { describe, expect, it } from 'vitest';
import {
  categorizeTitle,
  inferEmploymentType,
  inferExperienceLevels,
  inferLeadership,
  inferMinYears,
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
