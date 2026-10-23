import { CLASSIC_SECTION_KINDS, SECTION_KIND_IDS, type SectionKind } from '@tailorit/shared/resume';
import { templateNamesField } from '../locator/markup';
import { hasExtraSectionsMacro, inferNativeSectionOrder } from '../locator/sections';

// What a template can print, read from its markup on load and never stored: the editor and the chooser show it
// ("this template has no Projects section"), and the render honours it (a switch on, on a template with no such
// section, counts as off).

export interface TemplateCapabilities {
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
}

/** Whether the markup names the soft skills / strengths lists anywhere (a loop, a guard, an inline print). */
export function templateCapabilities(html: string): TemplateCapabilities {
  const source = typeof html === 'string' ? html : '';
  return {
    supportsSoftSkills: /\{\{[#\w\s]*softSkills\b/.test(source),
    supportsStrengths: /\{\{[#\w\s]*strengths\b/.test(source),
  };
}

/**
 * The section kinds a template prints, plus 'custom' for custom sections: a classic kind when the markup names its
 * field (skills: any of its three), the two optional ones exactly as `templateCapabilities` says, and every extra
 * kind when the markup names it or carries the extra-sections macro (which prints them all).
 */
export function printedSections(html: string): Array<SectionKind | 'custom'> {
  const source = typeof html === 'string' ? html : '';
  const names = (field: string) => templateNamesField(source, field);
  const macro = hasExtraSectionsMacro(source);
  const { supportsSoftSkills, supportsStrengths } = templateCapabilities(source);
  const classic = new Set<string>(CLASSIC_SECTION_KINDS);
  const printed: Array<SectionKind | 'custom'> = [];
  for (const kind of SECTION_KIND_IDS) {
    let prints: boolean;
    if (kind === 'skills') prints = names('skillCategories') || names('hardSkills') || names('skills');
    else if (kind === 'softSkills') prints = supportsSoftSkills;
    else if (kind === 'strengths') prints = supportsStrengths;
    else if (classic.has(kind)) prints = names(kind);
    else prints = macro || names(kind);
    if (prints) printed.push(kind);
  }
  if (macro || names('customSections')) printed.push('custom');
  return printed;
}

export { inferNativeSectionOrder };
