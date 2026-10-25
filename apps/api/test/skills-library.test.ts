import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { extractKeywords, findSoftSkills, HARD_SKILL_CATEGORIES, softKey, softSkillScanner, synonymKey } from '@tailorit/shared';
import { renderSkillCategory, skillIndexKey } from '@tailorit/render';
import { staticDir } from '../src/core/paths';
import { getSkillLibrary } from '../src/core/skills-vocabulary';
import { getResumeEngine } from '../src/features/resumes/engine';
import { createTestContext, type TestContext } from './helpers';

// The skill library (static/skills/skills.json): one entry per hard skill, the other spellings people write it as
// listed on it as `aliases`, sorted so the file reads as a catalogue, and no duplicates. These tests keep it that way:
// a failure says what to fix in the file.

interface FileEntry {
  skill: string;
  priority: number;
  category: string;
  aliases?: string[];
}
const RAW = readFileSync(staticDir('skills', 'skills.json'), 'utf8');
const FILE = JSON.parse(RAW) as { hard: FileEntry[]; soft: string[] };

/** The skill's name with only letters, digits, "+" and "#": "Argo CD", "ArgoCD" and "Argo-CD" read alike. */
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9+#]/g, '');
const byLowerCase = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
const headingRank = new Map<string, number>(HARD_SKILL_CATEGORIES.map((heading, index) => [heading, index]));

describe('skills.json: shape and order', () => {
  it('is JSON.stringify(…, null, 2) with LF line ends, so an edit changes only the lines it means to', () => {
    expect(RAW.replace(/\r\n/g, '\n')).toBe(`${JSON.stringify(FILE, null, 2)}\n`);
  });

  it('gives every hard skill a name, a priority from 1 to 5 and one of the 17 headings, and uses them all', () => {
    for (const entry of FILE.hard) {
      expect(Object.keys(entry).filter((key) => !['skill', 'priority', 'category', 'aliases'].includes(key)), entry.skill).toEqual([]);
      expect(entry.skill.trim(), 'a name').toBe(entry.skill);
      expect(entry.skill.length, `${entry.skill} has a name`).toBeGreaterThan(0);
      expect([1, 2, 3, 4, 5], `${entry.skill}: priority`).toContain(entry.priority);
      expect(headingRank.has(entry.category), `${entry.skill}: "${entry.category}" is not one of the headings`).toBe(true);
      if (entry.aliases) expect(entry.aliases.length, `${entry.skill}: an empty aliases list`).toBeGreaterThan(0);
    }
    expect(new Set(FILE.hard.map((entry) => entry.category)).size).toBe(HARD_SKILL_CATEGORIES.length);
  });

  it('is sorted by heading (the order of HARD_SKILL_CATEGORIES), then priority (1 first), then name', () => {
    for (let at = 1; at < FILE.hard.length; at += 1) {
      const before = FILE.hard[at - 1]!;
      const entry = FILE.hard[at]!;
      const order =
        headingRank.get(before.category)! - headingRank.get(entry.category)! ||
        before.priority - entry.priority ||
        byLowerCase(before.skill, entry.skill);
      expect(order, `"${before.skill}" (${before.category}, ${before.priority}) must come before "${entry.skill}" (${entry.category}, ${entry.priority})`).toBeLessThan(0);
    }
  });

  it('lists each skill\'s aliases alphabetically', () => {
    for (const entry of FILE.hard) {
      expect(entry.aliases ?? [], entry.skill).toEqual([...(entry.aliases ?? [])].sort(byLowerCase));
    }
  });

  it('keeps the soft skills alphabetical', () => {
    for (let at = 1; at < FILE.soft.length; at += 1) {
      expect(byLowerCase(FILE.soft[at - 1]!, FILE.soft[at]!), `"${FILE.soft[at - 1]}" before "${FILE.soft[at]}"`).toBeLessThan(0);
    }
  });
});

describe('skills.json: no duplicates', () => {
  const owners = FILE.hard.flatMap((entry) => [entry.skill, ...(entry.aliases ?? [])].map((spelling) => ({ spelling, owner: entry.skill })));

  it('writes no spelling twice, whatever the case or the spaces', () => {
    const seen = new Map<string, string>();
    for (const { spelling, owner } of owners) {
      const key = skillIndexKey(spelling);
      expect(seen.get(key), `"${spelling}" (of ${owner}) is already written as "${seen.get(key)}"`).toBeUndefined();
      seen.set(key, spelling);
    }
  });

  it('has no two skills written alike but for punctuation and spaces ("Argo CD", "ArgoCD"): make one the other\'s alias', () => {
    const seen = new Map<string, { spelling: string; owner: string }>();
    for (const { spelling, owner } of owners) {
      const key = squash(spelling);
      const before = seen.get(key);
      if (before) expect(owner, `"${spelling}" (of ${owner}) reads as "${before.spelling}" (of ${before.owner})`).toBe(before.owner);
      else seen.set(key, { spelling, owner });
    }
  });

  it('has no two entries the matcher counts as one keyword (they would be one skill listed twice): merge them', () => {
    const seen = new Map<string, string>();
    for (const entry of FILE.hard) {
      const key = synonymKey(entry.skill);
      expect(seen.get(key), `"${entry.skill}" and "${seen.get(key)}" are one keyword (TERM_SYNONYMS)`).toBeUndefined();
      seen.set(key, entry.skill);
    }
  });

  it('has no two soft skills the soft scanner reads as one', () => {
    const seen = new Map<string, string>();
    for (const skill of FILE.soft) {
      const key = softKey(skill);
      expect(seen.get(key), `"${skill}" and "${seen.get(key)}" read as one soft skill`).toBeUndefined();
      seen.set(key, skill);
    }
  });
});

describe('aliases', () => {
  const aliases = FILE.hard.flatMap((entry) => (entry.aliases ?? []).map((alias) => ({ alias, entry })));

  it('there are some, so these tests mean something', () => {
    expect(FILE.hard).toHaveLength(1453);
    expect(aliases).toHaveLength(39);
  });

  it('are the same keyword as their entry: list them together in TERM_SYNONYMS (packages/shared/src/match/terms.ts)', () => {
    for (const { alias, entry } of aliases) expect(synonymKey(alias), `"${alias}" and "${entry.skill}"`).toBe(synonymKey(entry.skill));
  });

  it('are found in a posting as written, and with their entry they are one keyword, not two', () => {
    const { vocabulary } = getSkillLibrary();
    for (const { alias, entry } of aliases) {
      const found = (text: string) => {
        const keywords = extractKeywords(text, vocabulary);
        return [...keywords.high, ...keywords.low].filter((group) => synonymKey(group.term) === synonymKey(entry.skill));
      };
      const alone = found(`Requirements:\n- Hands-on experience with ${alias} in production.`);
      expect(alone.map((group) => group.term), `${alias} alone`).toEqual([alias]);
      const both = found(`Requirements:\n- Experience with ${entry.skill}.\n- Day to day we use ${alias}.`);
      expect(both, `${entry.skill} and ${alias} together`).toHaveLength(1);
    }
  });

  it('are listed by the loader right after their entry, under its priority and heading', () => {
    const { spellings } = getSkillLibrary();
    expect(spellings).toEqual(
      FILE.hard.flatMap((entry) =>
        [entry.skill, ...(entry.aliases ?? [])].map((skill) => ({ skill, priority: entry.priority, category: entry.category })),
      ),
    );
    expect(getSkillLibrary().vocabulary).toEqual(FILE.hard.map((entry) => entry.skill));
    expect(getSkillLibrary().byKey.get('gcp')).toEqual({ skill: 'GCP', priority: 3, category: 'Cloud and Infrastructure' });
  });
});

describe('the render gate', () => {
  let ctx: TestContext | null = null;
  afterEach(() => {
    ctx?.cleanup();
    ctx = null;
  });

  it('files every spelling, an alias too, under its entry\'s heading', () => {
    ctx = createTestContext();
    const { library } = getResumeEngine(ctx.deps);
    for (const entry of FILE.hard) {
      for (const spelling of [entry.skill, ...(entry.aliases ?? [])]) {
        expect(renderSkillCategory(spelling, library), spelling).toBe(entry.category);
      }
    }
    // The spellings a resume's Grouped layout meets most.
    expect(renderSkillCategory('Kafka', library)).toBe('Data Engineering & Streaming');
    expect(renderSkillCategory('S3', library)).toBe('Databases and Storage');
    expect(renderSkillCategory('TDD', library)).toBe('Testing and Quality');
  });
});

describe('soft skills', () => {
  it('reads "Problem-solving" and "Big-picture thinking" as the one entry each, as before they were merged', () => {
    const { soft, vocabulary } = getSkillLibrary();
    const scanner = softSkillScanner(soft, vocabulary);
    expect(findSoftSkills('Strong problem-solving and big-picture thinking.', scanner, { max: 10 })).toEqual([
      'Problem Solving',
      'Big Picture Thinking',
    ]);
    expect(soft).toContain('Problem Solving');
    expect(soft).not.toContain('Problem-solving');
  });
});
