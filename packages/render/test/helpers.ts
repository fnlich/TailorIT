import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeResumeDocument, type ResumeDocument } from '@tailorit/shared/resume';
import {
  createSkillIndex,
  createTemplateStore,
  loadTemplateDirectory,
  readSampleResume,
  type SkillIndex,
  type SkillRecord,
  type TemplateStore,
} from '../src/index';

export const RENDER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(RENDER_ROOT, '..', '..');
export const TEMPLATES_DIR = join(REPO_ROOT, 'apps', 'api', 'static', 'resume-templates');
export const SKILLS_FILE = join(REPO_ROOT, 'apps', 'api', 'static', 'skills', 'skills.json');
export const SAMPLE_FILE = join(REPO_ROOT, 'apps', 'api', 'static', 'sample-resume.json');
export const FIXTURES_DIR = join(RENDER_ROOT, 'test', 'fixtures');
export const GOLDEN_DIR = join(RENDER_ROOT, 'test', 'golden', 'ft');

export const FIXTURE_NAMES = ['minimal', 'classic-six', 'all-kinds', 'two-page', 'unicode-links', 'skills'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

let store: TemplateStore | null = null;
export function templateStore(): TemplateStore {
  store ??= createTemplateStore(loadTemplateDirectory(TEMPLATES_DIR));
  return store;
}

let library: SkillIndex | null = null;
export function skillLibrary(): SkillIndex {
  library ??= createSkillIndex((JSON.parse(readFileSync(SKILLS_FILE, 'utf8')) as { hard: SkillRecord[] }).hard);
  return library;
}

export function fixture(name: FixtureName): ResumeDocument {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8')) as ResumeDocument;
}

export function sampleResume(): ResumeDocument {
  return readSampleResume(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
}

export function withSettings(
  document: ResumeDocument,
  layout: 'categorized' | 'flat',
  softSkills: boolean,
  strengths: boolean,
  extra: Partial<ResumeDocument> = {},
): ResumeDocument {
  return normalizeResumeDocument(
    { ...extra, resumeSettings: { technicalSkillsLayout: layout, includeSoftSkills: softSkills, includeStrengths: strengths } },
    document,
  );
}

function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>])\s*/g, '$1')
    .trim();
}

/** What the goldens compare: whitespace between tags collapsed, and CSS inside <style> normalised. */
export function comparable(html: string): string {
  return html
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attributes: string, css: string) => `<style${attributes}>${normalizeCss(css)}</style>`)
    .replace(/>\s+</g, '><')
    .trim();
}

/** The first difference between two strings, with context, for a readable failure. */
export function firstDifference(actual: string, expected: string, context = 160): string | null {
  if (actual === expected) return null;
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1;
  const from = Math.max(0, at - context);
  return (
    `differs at ${at} (actual ${actual.length} chars, expected ${expected.length})\n` +
    `  actual:   …${actual.slice(from, at + context)}…\n` +
    `  expected: …${expected.slice(from, at + context)}…`
  );
}

/** Visible text of an HTML document (tests that look for words). */
export function textOf(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#x27|#x3D|#x60|nbsp);/g, (_match, name: string) => ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
  '#x3D': '=',
  '#x60': '`',
  nbsp: ' ',
};
