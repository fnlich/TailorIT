import { readFileSync } from 'node:fs';
import { staticDir } from './paths';

// The skill library (static/skills/skills.json, from free_tailor v4.2's data and tidied since): hard skills, one entry
// each, with a priority (1 to 5), a category and the other spellings people write it as (`aliases`), and soft skills.
// Read once per process. The vocabulary for keyword extraction and matching is the hard names; the resume editor's
// library adds each user's own skills on top (user_skills).
//
// An alias is a spelling of its entry's skill: "Kafka" of "Apache Kafka". It is the same keyword (TERM_SYNONYMS in
// packages/shared lists it with its entry, which a test checks), it is filed under its entry's heading by the render
// gate, and the skill picker still offers it, as people write it on resumes.

export interface HardSkill {
  skill: string;
  priority: number | null;
  category: string;
  /** Other spellings of the skill, as the file writes them. */
  aliases: readonly string[];
}

/** One spelling of a hard skill: the entry's own name, or one of its aliases under the entry's priority and category. */
export interface HardSpelling {
  skill: string;
  priority: number | null;
  category: string;
}

export interface SkillLibrary {
  /** One entry per skill, in the file's order (category, priority, name). */
  hard: readonly HardSkill[];
  soft: readonly string[];
  /** Hard skill names only (an alias is the same keyword as its entry), for keyword extraction. */
  vocabulary: readonly string[];
  /** Every spelling: each entry's name, then its aliases. */
  spellings: readonly HardSpelling[];
  /** Lower-cased spelling (an entry's name or an alias) -> its record (the library's own spelling and category). */
  byKey: ReadonlyMap<string, HardSpelling>;
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
    const e = entry as { skill?: unknown; priority?: unknown; category?: unknown; aliases?: unknown };
    if (typeof e.skill !== 'string' || !e.skill.trim()) continue;
    const skill = e.skill.trim();
    const aliases = Array.isArray(e.aliases)
      ? e.aliases
          .filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '')
          .map((alias) => alias.trim())
          .filter((alias) => alias.toLowerCase() !== skill.toLowerCase())
      : [];
    hard.push({
      skill,
      priority: typeof e.priority === 'number' ? e.priority : null,
      category: typeof e.category === 'string' ? e.category : '',
      aliases,
    });
  }
  const soft = data.soft.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
  const spellings: HardSpelling[] = [];
  for (const { skill, priority, category, aliases } of hard) {
    spellings.push({ skill, priority, category });
    for (const alias of aliases) spellings.push({ skill: alias, priority, category });
  }
  const byKey = new Map<string, HardSpelling>();
  for (const spelling of spellings) if (!byKey.has(spelling.skill.toLowerCase())) byKey.set(spelling.skill.toLowerCase(), spelling);
  cached = { hard, soft, vocabulary: hard.map((s) => s.skill), spellings, byKey };
  return cached;
}
