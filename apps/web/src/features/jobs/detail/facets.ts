import { NOT_SPECIFIED_INDUSTRY, industryLabel, type JobAnalysisView, type MatchResult } from '@tailorit/shared';

/*
 * What the job page shows of a job's analysis besides its summary and keywords (work package WP8): the experience the
 * posting asks for (facts grid), its soft skills, certifications and industries ("Skills and keywords" in About the
 * job's Summary), and which resume the keyword card scored. Pure: the components only lay these out.
 */

/**
 * The facts grid's required experience, "Experience: 7+ years"; '' when the posting asks for no minimum: it does not
 * say (null), or it starts at 0 ("0-2 years of experience"), which tells a reader nothing.
 */
export function requiredExperienceText(years: number | null | undefined): string {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 1) return '';
  return `Experience: ${Math.floor(years)}+ years`;
}

/** Industry ids never shown as a posting's industry: they say nothing about it (the shared reading never names them). */
const UNSHOWN_INDUSTRIES: ReadonlySet<string> = new Set(['technology', 'other', NOT_SPECIFIED_INDUSTRY]);

/** The labels of industries (INDUSTRIES ids) from the shared taxonomy, in order, once each; unknown ids are left out. */
export function industryLabels(ids: readonly string[] | null | undefined): string[] {
  const labels: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== 'string' || UNSHOWN_INDUSTRIES.has(id)) continue;
    const label = industryLabel(id);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** The names, trimmed, in order, each once (ignoring case); blanks are dropped. */
function distinctNames(names: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const name of names ?? []) {
    const text = typeof name === 'string' ? name.trim() : '';
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept;
}

export type JobFacetKey = 'softSkills' | 'certifications' | 'industries';

/** One labelled row of chips under "Skills and keywords". */
export interface JobFacetGroup {
  key: JobFacetKey;
  label: string;
  items: string[];
}

/**
 * "Skills and keywords": the posting's soft skills, then the keywords it names beside its skills (certifications and
 * industries; its hard skills are the keyword card's). Only the groups with something in them, in that order: [] when
 * the analysis has none, or is from before they were read.
 */
export function jobFacetGroups(analysis: Pick<JobAnalysisView, 'softSkills' | 'terms'> | null | undefined): JobFacetGroup[] {
  if (!analysis) return [];
  const groups: JobFacetGroup[] = [
    { key: 'softSkills', label: 'Soft skills', items: distinctNames(analysis.softSkills) },
    { key: 'certifications', label: 'Certifications', items: distinctNames(analysis.terms?.certifications) },
    { key: 'industries', label: 'Industries', items: industryLabels(analysis.terms?.domains) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** Follows the scored resume's name when it is the one linked to the job's application (a saved or applied job). */
export const LINKED_RESUME_NOTE = '(linked to this saved job)';

/** The keyword card's line naming the resume it scored, in parts (the card sets the name apart). */
export interface ScoredWithLine {
  lead: 'Scored with';
  label: string;
  /** LINKED_RESUME_NOTE for the resume linked to the job's application, '' for the default resume. */
  note: string;
}

/**
 * Which resume the keyword card scored: "Scored with {label}", plus "(linked to this saved job)" when it is the
 * application's. Null when there is none to name: no resume, or an answer that does not say which.
 */
export function scoredWithLine(
  match: Pick<MatchResult, 'state' | 'resumeLabel' | 'resumeBasis'> | null | undefined,
): ScoredWithLine | null {
  if (!match || match.state !== 'ok') return null;
  const label = match.resumeLabel?.trim();
  if (!label) return null;
  return { lead: 'Scored with', label, note: match.resumeBasis === 'linked' ? LINKED_RESUME_NOTE : '' };
}

/** The line as one sentence: "Scored with Backend Resume (linked to this saved job)". */
export function scoredWithText(line: ScoredWithLine): string {
  return [line.lead, line.label, line.note].filter(Boolean).join(' ');
}
