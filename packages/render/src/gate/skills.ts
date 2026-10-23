import { HARD_SKILL_CATEGORIES, type TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { renderSkillCategory, skillIndexKey, type SkillIndex } from '../skills/library';

// The Technical Skills block of an untailored render: the resume's own skills, never padded from the library and
// never reordered by its priorities.
//   Grouped: the author's own headings when the resume has any (every skill; one they never placed goes under the
//            library's heading for it), else each skill under the library's heading, in the library's heading order,
//            library-known skills only.
//   Plain:   one headless group of the library-known skills, in the person's order and the library's spelling.
// Templates read the block three ways: `skillCategories` (groups), and `hardSkills` / `skills` (one line each).

/** One printed heading and its skills; '' is Plain's "no heading". */
export interface SkillGroup {
  category: string;
  skills: string[];
}

/** Strings only, trimmed, a name repeated in another case dropped. */
export function dedupeSkills(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of skills) {
    if (typeof entry !== 'string') continue;
    const skill = entry.trim();
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

/** The library-known skills, in the person's order, in the library's spelling. */
function libraryKnown(skills: readonly string[], library: SkillIndex): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const skill of dedupeSkills(skills)) {
    const record = library.get(skill);
    if (!record) continue;
    const key = skillIndexKey(record.skill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(record.skill);
  }
  return out;
}

/** The author's grouping as a map from skill to heading; their headings lead, a skill they never placed follows. */
function authoredGroups(
  selected: readonly string[],
  authored: ReadonlyArray<{ category: string; skills: readonly string[] }>,
  library: SkillIndex,
): SkillGroup[] {
  const headingOf = new Map<string, string>();
  for (const group of authored) {
    const category = group.category.trim();
    if (!category) continue;
    for (const skill of group.skills) {
      const key = skillIndexKey(skill);
      if (key && !headingOf.has(key)) headingOf.set(key, category);
    }
  }
  const order: string[] = [];
  const grouped = new Map<string, string[]>();
  const open = (heading: string) => {
    const key = heading.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(heading);
    }
    return grouped.get(key)!;
  };
  for (const group of authored) {
    const category = group.category.trim();
    if (category) open(category);
  }
  const seen = new Set<string>();
  for (const skill of selected) {
    const key = skillIndexKey(skill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    open(headingOf.get(key) ?? renderSkillCategory(skill, library)).push(skill);
  }
  return order
    .map((category) => ({ category, skills: grouped.get(category.toLowerCase()) ?? [] }))
    .filter((group) => group.skills.length > 0);
}

/** Each library-known skill under the library's heading, headings in the library's order. */
function libraryGroups(skills: readonly string[], library: SkillIndex): SkillGroup[] {
  const grouped = new Map<string, string[]>(HARD_SKILL_CATEGORIES.map((category) => [category, [] as string[]]));
  for (const skill of libraryKnown(skills, library)) grouped.get(renderSkillCategory(skill, library))?.push(skill);
  return HARD_SKILL_CATEGORIES.map((category) => ({ category, skills: grouped.get(category) ?? [] })).filter(
    (group) => group.skills.length > 0,
  );
}

/** The author's headings that have something under them. */
function headedGroups(skillCategories: unknown): Array<{ category: string; skills: string[] }> {
  if (!Array.isArray(skillCategories)) return [];
  return skillCategories
    .filter(
      (group): group is { category: string; skills: unknown[] } =>
        Boolean(group) &&
        typeof group === 'object' &&
        typeof (group as { category?: unknown }).category === 'string' &&
        (group as { category: string }).category.trim() !== '' &&
        Array.isArray((group as { skills?: unknown }).skills) &&
        (group as { skills: unknown[] }).skills.length > 0,
    )
    .map((group) => ({
      category: group.category,
      skills: group.skills.filter((skill): skill is string => typeof skill === 'string'),
    }));
}

/** The resume's own skills block for a layout. */
export function skillGroupsFor(
  source: { skills?: unknown; skillCategories?: unknown },
  layout: TechnicalSkillsLayout,
  library: SkillIndex,
): SkillGroup[] {
  const skills = dedupeSkills(source.skills);
  if (layout === 'flat') {
    const known = libraryKnown(skills, library);
    return known.length > 0 ? [{ category: '', skills: known }] : [];
  }
  const authored = headedGroups(source.skillCategories);
  return authored.length > 0 ? authoredGroups(skills, authored, library) : libraryGroups(skills, library);
}

/**
 * The block as lines, for templates that print a flat list: "Heading: a, b, c" per group; Plain's one headless
 * group is one line per skill (a chip per skill, never one chip holding the whole list).
 */
export function skillLines(groups: readonly SkillGroup[]): string[] {
  const only = groups[0];
  if (groups.length === 1 && only && !only.category) return [...only.skills];
  return groups.map((group) => (group.category ? `${group.category}: ${group.skills.join(', ')}` : group.skills.join(', ')));
}
