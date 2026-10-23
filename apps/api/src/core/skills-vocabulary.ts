import { readFileSync } from 'node:fs';
import { staticDir } from './paths';

// The skill library (static/skills/skills.json, free_tailor's data reused as-is): 1,492 hard skills with a priority and
// a category, and 1,247 soft skills. Read once per process. The vocabulary for keyword extraction and matching is the
// hard list; the resume editor's library adds each user's own skills on top (user_skills).

export interface HardSkill {
  skill: string;
  priority: number | null;
  category: string;
}

export interface SkillLibrary {
  hard: readonly HardSkill[];
  soft: readonly string[];
  /** Hard skill names only, for keyword extraction. */
  vocabulary: readonly string[];
  /** Lower-cased hard skill name -> its library entry (the library's own spelling and category). */
  byKey: ReadonlyMap<string, HardSkill>;
}

let cached: SkillLibrary | null = null;

/** The skill library, parsed once. Throws a readable error if the data file is missing or malformed. */
export function getSkillLibrary(): SkillLibrary {
  if (cached) return cached;
  const file = staticDir('skills', 'skills.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the skill library at ${file}: ${(error as Error).message}`);
  }
  const data = raw as { hard?: unknown; soft?: unknown };
  if (!Array.isArray(data.hard) || !Array.isArray(data.soft)) {
    throw new Error(`The skill library at ${file} must have "hard" and "soft" arrays.`);
  }
  const hard: HardSkill[] = [];
  for (const entry of data.hard) {
    const e = entry as { skill?: unknown; priority?: unknown; category?: unknown };
    if (typeof e.skill !== 'string' || !e.skill.trim()) continue;
    hard.push({
      skill: e.skill.trim(),
      priority: typeof e.priority === 'number' ? e.priority : null,
      category: typeof e.category === 'string' ? e.category : '',
    });
  }
  const soft = data.soft.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
  const byKey = new Map<string, HardSkill>();
  for (const skill of hard) if (!byKey.has(skill.skill.toLowerCase())) byKey.set(skill.skill.toLowerCase(), skill);
  cached = { hard, soft, vocabulary: hard.map((s) => s.skill), byKey };
  return cached;
}
