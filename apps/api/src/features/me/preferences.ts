import {
  EMPLOYMENT_TYPES,
  EMPTY_PREFERENCES,
  EXPERIENCE_LEVELS,
  WORK_ARRANGEMENTS,
  type Preferences,
} from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';

// The signed-in user's job preferences and the contact fields cover letters fall back on. One row per user, created
// on first save; a user without one has EMPTY_PREFERENCES.

interface PreferencesRow {
  experience_levels: string;
  job_types: string;
  work_arrangements: string;
  categories: string;
  locations: string;
  min_salary: number | null;
  phone: string;
  linkedin_url: string;
  location: string;
  portfolio_url: string;
}

/** A stored JSON list, keeping only allowed strings (a value retired from an enum quietly drops out). */
function readList<T extends string>(json: string, allowed?: readonly T[]): T[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is T => typeof item === 'string' && (!allowed || (allowed as readonly string[]).includes(item)),
  );
}

export function getPreferences(deps: Pick<AppDeps, 'db'>, userId: string): Preferences {
  const row = deps.db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) as
    | PreferencesRow
    | undefined;
  if (!row) return { ...EMPTY_PREFERENCES };
  return {
    experienceLevels: readList(row.experience_levels, EXPERIENCE_LEVELS),
    jobTypes: readList(row.job_types, EMPLOYMENT_TYPES),
    workArrangements: readList(row.work_arrangements, WORK_ARRANGEMENTS),
    categories: readList(row.categories),
    locations: readList(row.locations),
    minSalary: row.min_salary,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    location: row.location,
    portfolioUrl: row.portfolio_url,
  };
}

/** Trims every value and drops blank and repeated list entries, so the stored form is canonical. */
export function normalizePreferences(input: Preferences): Preferences {
  const list = <T extends string>(items: T[]) => [...new Set(items.map((item) => item.trim() as T).filter(Boolean))];
  return {
    experienceLevels: list(input.experienceLevels),
    jobTypes: list(input.jobTypes),
    workArrangements: list(input.workArrangements),
    categories: list(input.categories),
    locations: list(input.locations),
    minSalary: input.minSalary,
    phone: input.phone.trim(),
    linkedinUrl: input.linkedinUrl.trim(),
    location: input.location.trim(),
    portfolioUrl: input.portfolioUrl.trim(),
  };
}

export function savePreferences(deps: AppDeps, userId: string, preferences: Preferences): Preferences {
  deps.db
    .prepare(
      `INSERT INTO user_preferences(user_id, experience_levels, job_types, work_arrangements, categories, locations,
         min_salary, phone, linkedin_url, location, portfolio_url, updated_at)
       VALUES (@userId, @experienceLevels, @jobTypes, @workArrangements, @categories, @locations, @minSalary, @phone,
         @linkedinUrl, @location, @portfolioUrl, @updatedAt)
       ON CONFLICT(user_id) DO UPDATE SET experience_levels = excluded.experience_levels,
         job_types = excluded.job_types, work_arrangements = excluded.work_arrangements,
         categories = excluded.categories, locations = excluded.locations, min_salary = excluded.min_salary,
         phone = excluded.phone, linkedin_url = excluded.linkedin_url, location = excluded.location,
         portfolio_url = excluded.portfolio_url, updated_at = excluded.updated_at`,
    )
    .run({
      userId,
      experienceLevels: JSON.stringify(preferences.experienceLevels),
      jobTypes: JSON.stringify(preferences.jobTypes),
      workArrangements: JSON.stringify(preferences.workArrangements),
      categories: JSON.stringify(preferences.categories),
      locations: JSON.stringify(preferences.locations),
      minSalary: preferences.minSalary,
      phone: preferences.phone,
      linkedinUrl: preferences.linkedinUrl,
      location: preferences.location,
      portfolioUrl: preferences.portfolioUrl,
      updatedAt: nowIso(deps),
    });
  return getPreferences(deps, userId);
}
