import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ResumeDocument } from '@tailorit/shared/resume';
import { createTemplateStore, loadTemplateDirectory, renderPreviewDocument, setRenderWarningSink } from '../src/index';
import {
  comparable,
  firstDifference,
  FIXTURES_DIR,
  fixture,
  GOLDEN_DIR,
  SKILLS_FILE,
  skillLibrary,
  TEMPLATES_DIR,
  templateStore,
  type FixtureName,
} from './helpers';

// TailorIT's engine against free_tailor's own compiled renderer (tools/ft-golden/generate.mjs): the same resume and
// template must give the same document. Regenerate with `npm run golden:ft` after changing a fixture.

interface GoldenCase {
  template: string;
  /** One of TailorIT's synthetic templates (test/fixtures/templates), not one of the 26. */
  synthetic?: boolean;
  id: string;
  fixture: FixtureName;
  layout: 'categorized' | 'flat';
  softSkills: boolean;
  strengths: boolean;
  order: 'native' | 'reversed';
  sectionOrder: string[] | null;
  noCategories: boolean;
  page: { widthPx: number; heightPx: number; contentHeightPx: number };
  sha256: string;
}

interface Manifest {
  freeTailor: { commit: string; distMtime: string };
  inputs: {
    templates: Record<string, string>;
    syntheticTemplates: Record<string, string>;
    skills: string;
    fixtures: Record<string, string>;
  };
  cases: GoldenCase[];
}

// free_tailor warns about the same templates (see manifest.freeTailorMessages); the run need not.
setRenderWarningSink(() => undefined);

const manifest = JSON.parse(readFileSync(join(GOLDEN_DIR, 'manifest.json'), 'utf8')) as Manifest;
/** `"<template>|<case id>": "why it may differ"`. */
const expectedDiff = JSON.parse(readFileSync(join(GOLDEN_DIR, 'expected-diff.json'), 'utf8')) as Record<string, string>;
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const SYNTHETIC_DIR = join(FIXTURES_DIR, 'templates');
const synthetic = createTemplateStore(loadTemplateDirectory(SYNTHETIC_DIR));

function caseDocument(item: GoldenCase): ResumeDocument {
  const document: ResumeDocument = {
    ...fixture(item.fixture),
    resumeSettings: { technicalSkillsLayout: item.layout, includeSoftSkills: item.softSkills, includeStrengths: item.strengths },
  };
  if (item.noCategories) delete document.skillCategories;
  if (item.sectionOrder) document.sectionOrder = item.sectionOrder;
  return document;
}

function bundle(templateId: string): Record<string, string> {
  const file = join(GOLDEN_DIR, `${templateId}.json.br`);
  return (JSON.parse(brotliDecompressSync(readFileSync(file)).toString('utf8')) as { cases: Record<string, string> }).cases;
}

describe('golden inputs', () => {
  it('were generated from the templates, skill library and fixtures in this tree', () => {
    for (const [file, hash] of Object.entries(manifest.inputs.templates)) {
      expect(sha256(readFileSync(join(TEMPLATES_DIR, file))), `template ${file}`).toBe(hash);
    }
    for (const [file, hash] of Object.entries(manifest.inputs.syntheticTemplates)) {
      expect(sha256(readFileSync(join(SYNTHETIC_DIR, file))), `synthetic template ${file}`).toBe(hash);
    }
    expect(sha256(readFileSync(SKILLS_FILE)), 'skills.json').toBe(manifest.inputs.skills);
    for (const [name, hash] of Object.entries(manifest.inputs.fixtures)) {
      expect(sha256(readFileSync(join(FIXTURES_DIR, `${name}.json`))), `fixture ${name} (run npm run golden:ft)`).toBe(hash);
    }
  });

  it('cover all 26 templates (about 900 cases) plus the synthetic ones', () => {
    const real = manifest.cases.filter((item) => !item.synthetic);
    expect(new Set(real.map((item) => item.template)).size).toBe(26);
    expect(real.length).toBeGreaterThan(600);
    expect(new Set(manifest.cases.filter((item) => item.synthetic).map((item) => item.template)).size).toBe(
      synthetic.list().length,
    );
    for (const key of Object.keys(expectedDiff)) {
      const [template, ...rest] = key.split('|');
      expect(
        manifest.cases.some((item) => item.template === template && item.id === rest.join('|')),
        `expected-diff entry ${key} names a case`,
      ).toBe(true);
    }
  });
});

const byTemplate = new Map<string, GoldenCase[]>();
for (const item of manifest.cases) byTemplate.set(item.template, [...(byTemplate.get(item.template) ?? []), item]);

describe.each([...byTemplate.keys()].sort())('free_tailor parity: %s', (templateId) => {
  it('renders every case exactly as free_tailor does', () => {
    const template = templateStore().get(templateId) ?? synthetic.get(templateId);
    expect(template, `template ${templateId} loads`).not.toBeNull();
    expect(existsSync(join(GOLDEN_DIR, `${templateId}.json.br`))).toBe(true);
    const golden = bundle(templateId);
    const failures: string[] = [];
    let allowed = 0;
    for (const item of byTemplate.get(templateId)!) {
      const expected = golden[item.id];
      if (expected === undefined) {
        failures.push(`${item.id}: no golden html`);
        continue;
      }
      const rendered = renderPreviewDocument(caseDocument(item), template!, skillLibrary());
      const difference = firstDifference(comparable(rendered.html), comparable(expected));
      const pageDiffers = JSON.stringify(rendered.page) !== JSON.stringify(item.page);
      const key = `${templateId}|${item.id}`;
      if (expectedDiff[key]) {
        allowed += 1;
        continue;
      }
      if (difference) failures.push(`${item.id}: ${difference}`);
      if (pageDiffers) failures.push(`${item.id}: page ${JSON.stringify(rendered.page)} != ${JSON.stringify(item.page)}`);
    }
    expect(failures.slice(0, 3).join('\n\n') + (failures.length > 3 ? `\n\n...and ${failures.length - 3} more` : '')).toBe('');
    expect(allowed).toBeLessThanOrEqual(byTemplate.get(templateId)!.length);
  });
});
