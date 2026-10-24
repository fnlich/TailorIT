'use client';

import { industryLabel } from '@tailorit/shared/jobs';
import { ResumeAnalysisViewSchema, YEARS_BASES, type ResumeAnalysisView, type YearsBasis } from '@tailorit/shared/resume';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { noteMismatch, readYears, resumeKeys } from './api';

/*
 * "What TailorIT read from this resume" (GET /api/resumes/:id/analysis): read leniently like the other resume
 * answers, polled while the AI reading is under way or waiting its turn (backing off, and stopping after ten
 * minutes), and put into words for the panel on an upload's page.
 */

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {});
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

/** The answer as the contract says, else the fields this page needs picked out by hand (null when it names no resume). */
export function readResumeAnalysis(raw: unknown): ResumeAnalysisView | null {
  const parsed = ResumeAnalysisViewSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  noteMismatch('GET /api/resumes/:id/analysis', parsed.error.issues.slice(0, 5));
  const r = rec(raw);
  const resumeId = typeof r.resumeId === 'string' ? r.resumeId : '';
  if (!resumeId) return null;
  const keywords = rec(r.keywords);
  return {
    resumeId,
    source: r.source === 'ai' ? 'ai' : 'deterministic',
    refining: r.refining === true,
    aiWaiting: r.aiWaiting === true,
    aiFailed: r.aiFailed === true,
    hardSkills: strings(r.hardSkills),
    softSkills: strings(r.softSkills),
    keywords: {
      roles: strings(keywords.roles),
      certifications: strings(keywords.certifications),
      domains: strings(keywords.domains),
    },
    yearsExperience: readYears(r.yearsExperience),
    yearsBasis: (YEARS_BASES as readonly unknown[]).includes(r.yearsBasis) ? (r.yearsBasis as YearsBasis) : null,
    analyzedAt: typeof r.analyzedAt === 'string' ? r.analyzedAt : '',
  };
}

/** The reading of one resume; null when there is none to show (404: not this account's, or an API without it). */
export async function fetchResumeAnalysis(id: string, signal?: AbortSignal): Promise<ResumeAnalysisView | null> {
  try {
    return readResumeAnalysis(await api.get(`/api/resumes/${encodeURIComponent(id)}/analysis`, { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The AI reading is under way or waiting its turn: the reading is asked for again. */
export function analysisPending(view: ResumeAnalysisView | null | undefined): boolean {
  return Boolean(view && (view.refining || view.aiWaiting));
}

// ------------------------------------------------------------------------------------------------- polling

/** While a reading is still to come: every 10 s for a minute, every 30 s to three minutes, every minute to ten. */
export const ANALYSIS_POLL_STEPS: ReadonlyArray<{ untilMs: number; everyMs: number }> = [
  { untilMs: 60_000, everyMs: 10_000 },
  { untilMs: 3 * 60_000, everyMs: 30_000 },
  { untilMs: 10 * 60_000, everyMs: 60_000 },
];

/** How long until the next read, `elapsedMs` after the wait began; false once ten minutes have gone by. */
export function analysisPollDelay(elapsedMs: number): number | false {
  return ANALYSIS_POLL_STEPS.find((step) => elapsedMs < step.untilMs)?.everyMs ?? false;
}

/**
 * Remembers since when a reading has been awaited, for React Query's `refetchInterval`: `next(pending, now)` gives the
 * delay (false when nothing is awaited, or after ten minutes); `reset()` starts over (after a new upload).
 */
export interface PollClock {
  next: (pending: boolean, now: number) => number | false;
  reset: () => void;
}

export function createPollClock(): PollClock {
  let since: number | null = null;
  return {
    next(pending, now) {
      if (!pending) {
        since = null;
        return false;
      }
      since ??= now;
      return analysisPollDelay(now - since);
    },
    reset() {
      since = null;
    },
  };
}

/** One resume's reading, read again while the AI reading is still to come. */
export function useResumeAnalysis(id: string) {
  const [clock] = useState(createPollClock);
  return useQuery({
    queryKey: resumeKeys.analysis(id),
    queryFn: ({ signal }) => fetchResumeAnalysis(id, signal),
    refetchInterval: (query) => clock.next(analysisPending(query.state.data), Date.now()),
  });
}

// ------------------------------------------------------------------------------------------------ the words

/** "About 8 years", "About 1 year" (1 to under 1.5), "Less than a year"; "Not found on this resume". */
export function experienceText(years: number | null): string {
  if (years === null) return 'Not found on this resume';
  if (years < 1) return 'Less than a year';
  if (years < 1.5) return 'About 1 year';
  return `About ${Math.round(years)} years`;
}

/** Where the years come from. */
export function basisText(basis: YearsBasis | null): string | null {
  switch (basis) {
    case 'dates':
      return 'Added up from the dates of your roles.';
    case 'field':
      return 'From the years of experience you entered.';
    case 'stated':
      return 'From your summary.';
    default:
      return null;
  }
}

/** Industry ids by name ("finance" → "Finance"); unknown ids are left out. */
export function industryNames(ids: readonly string[]): string[] {
  return ids.map((id) => industryLabel(id)).filter(Boolean);
}

export type AnalysisNoteKind = 'reading' | 'waiting' | 'failed' | 'ai' | 'quick';

/** The note under the heading: how the reading was made, or what the AI is doing. */
export function analysisNote(view: ResumeAnalysisView): { kind: AnalysisNoteKind; text: string } {
  if (view.refining) return { kind: 'reading', text: 'Reading it with AI for a closer look...' };
  if (view.aiWaiting) {
    return { kind: 'waiting', text: 'Waiting for the AI reading. Uploads are read one at a time, so it can take a while.' };
  }
  if (view.aiFailed) return { kind: 'failed', text: 'The AI reading did not work, so this is the quick reading.' };
  if (view.source === 'ai') return { kind: 'ai', text: 'Read with AI. Everything shown here appears in your file.' };
  return { kind: 'quick', text: "Found by matching your file against TailorIT's skill list." };
}
