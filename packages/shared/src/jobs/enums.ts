// Job vocabulary shared by Jobs, the Tracker, preferences and ingestion. Labels are Simplify's wording.

export const EMPLOYMENT_TYPES = ['internship', 'full_time', 'part_time', 'contract'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  internship: 'Internship',
  full_time: 'Full-Time',
  part_time: 'Part-Time',
  contract: 'Contract',
};

export const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'onsite'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];
export const WORK_ARRANGEMENT_LABEL: Record<WorkArrangement, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'In Person',
};

export const EXPERIENCE_LEVELS = ['entry', 'junior', 'mid', 'senior', 'expert'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
/** Filter / preference labels. */
export const EXPERIENCE_LEVEL_LABEL: Record<ExperienceLevel, string> = {
  entry: 'Entry Level/New Grad',
  junior: 'Junior',
  mid: 'Mid Level',
  senior: 'Senior',
  expert: 'Expert or higher',
};
/** Facts-grid and match-tooltip labels. */
export const EXPERIENCE_LEVEL_SHORT: Record<ExperienceLevel, string> = {
  entry: 'Entry',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  expert: 'Expert',
};

export const LEADERSHIP = ['ic', 'manager'] as const;
export type Leadership = (typeof LEADERSHIP)[number];
export const LEADERSHIP_LABEL: Record<Leadership, string> = {
  ic: 'Individual Contributor',
  manager: 'Manager',
};

export const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];
/** Suffix after a salary range, e.g. "$120k - $150k/yr". */
export const SALARY_PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  year: '/yr',
  month: '/mo',
  week: '/wk',
  day: '/day',
  hour: '/hr',
};
export const SALARY_PERIOD_LABEL: Record<SalaryPeriod, string> = {
  year: 'Yearly',
  month: 'Monthly',
  week: 'Weekly',
  day: 'Daily',
  hour: 'Hourly',
};
