#!/usr/bin/env node
/* global console */
// Writes packages/shared/src/match/library-synonyms.ts from apps/api/static/skills/skills.json: one group for each hard
// skill that has aliases, its own name first. The matcher (packages/shared/src/match/terms.ts) reads that module, as
// the shared package imports no JSON, so a skill and its aliases are one keyword everywhere.
//
//   node tools/skills/library-synonyms.mjs            (npm run skills:synonyms)
//
// Run it after every change to the aliases; apps/api/test/skills-library.test.ts fails while the module is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SKILLS_FILE = path.join(REPO, 'apps', 'api', 'static', 'skills', 'skills.json');
const OUT_FILE = path.join(REPO, 'packages', 'shared', 'src', 'match', 'library-synonyms.ts');

const { hard } = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
const groups = hard
  .filter((entry) => Array.isArray(entry.aliases) && entry.aliases.length > 0)
  .map((entry) => [entry.skill, ...entry.aliases]);
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const source = [
  '// Generated from apps/api/static/skills/skills.json by `npm run skills:synonyms` (tools/skills/library-synonyms.mjs).',
  '// Do not edit: change the aliases in skills.json and run the script again.',
  '',
  '/** Each skill library entry that has aliases, as a synonym group: the entry\'s name, then its aliases. */',
  'export const LIBRARY_SYNONYMS: ReadonlyArray<readonly string[]> = [',
  ...groups.map((group) => `  [${group.map(quote).join(', ')}],`),
  '];',
  '',
].join('\n');

fs.writeFileSync(OUT_FILE, source, 'utf8');
console.log(`skills:synonyms: ${groups.length} groups from ${path.relative(REPO, SKILLS_FILE)} -> ${path.relative(REPO, OUT_FILE)}`);
