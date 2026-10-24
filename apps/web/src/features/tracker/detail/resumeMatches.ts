import { ResumeMatchListSchema, STATUS, type ApplicationDetail, type ResumeMatchList, type ResumeOrigin } from '@tailorit/shared';

/*
 * The resume of an application as the Documents tab shows it (work package WP10): who chose the linked resume, and
 * the picker's options ranked by how well each resume fits the job (GET /api/applications/:id/resume-matches, best
 * first). The numbers people see are the Jobs card's ("9 of 12 keywords · 75%"); the weighted fit only orders the
 * list and is never shown. Answers are read leniently: one this page only partly understands still gives the options
 * it can, and one it cannot read at all (null) sends the picker back to the plain resume list.
 */

export const BEST_MATCH = 'Best match';
export const CHOSEN_BY_YOU = 'Chosen by you';

/** One resume of the ranking, as this page uses it. */
export interface ResumeMatchEntry {
  resumeId: string;
  label: string;
  /** 'built' or 'uploaded'. */
  kind: string;
  isDefault: boolean;
  /** The weighted fit, 0-100: it orders the list and is never shown. */
  fit: number;
  /** The Jobs card's numbers for this resume. */
  matchedCount: number;
  total: number;
  percentage: number;
}

/** The ranking of an application's resumes, as this page reads it. */
export interface ResumeMatchView {
  /** What the resumes were compared with: the job's posting, or the application's own description. */
  basis: 'job' | 'description';
  /** The job names keywords. Without them no resume carries numbers, and none is the "Best match". */
  scored: boolean;
  /** Best first, in the server's order (its tie-breaks included). */
  items: ResumeMatchEntry[];
}

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {});

/** A whole number of at least 0, else 0. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function clampFit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** Each resume once (the first, the better ranked, wins). */
function unique(entries: Array<ResumeMatchEntry | null>): ResumeMatchEntry[] {
  const seen = new Set<string>();
  const out: ResumeMatchEntry[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry.resumeId)) continue;
    seen.add(entry.resumeId);
    out.push(entry);
  }
  return out;
}

function entryOf(item: ResumeMatchList['items'][number]): ResumeMatchEntry {
  return {
    resumeId: item.resumeId,
    label: item.label.trim() || 'Untitled resume',
    kind: item.kind,
    isDefault: item.isDefault,
    fit: item.fit,
    matchedCount: Math.min(item.matchedCount, item.total),
    total: item.total,
    percentage: item.percentage,
  };
}

/** One item picked out by hand; null when it names no resume. */
function looseEntry(value: unknown): ResumeMatchEntry | null {
  const r = rec(value);
  const resumeId = typeof r.resumeId === 'string' ? r.resumeId : typeof r.id === 'string' ? r.id : '';
  if (!resumeId) return null;
  const total = count(r.total);
  const matchedCount = Math.min(count(r.matchedCount), total);
  const percentage =
    typeof r.percentage === 'number' && Number.isFinite(r.percentage)
      ? Math.min(100, Math.max(0, Math.round(r.percentage)))
      : total > 0
        ? Math.round((matchedCount / total) * 100)
        : 0;
  return {
    resumeId,
    label: (typeof r.label === 'string' && r.label.trim()) || (typeof r.title === 'string' && r.title.trim()) || 'Untitled resume',
    kind: r.kind === 'uploaded' ? 'uploaded' : 'built',
    isDefault: r.isDefault === true,
    fit: clampFit(r.fit),
    matchedCount,
    total,
    percentage,
  };
}

/** The ranking as the contract says; else the parts this page needs, picked out by hand; null when there is none. */
export function readResumeMatches(raw: unknown): ResumeMatchView | null {
  const parsed = ResumeMatchListSchema.safeParse(raw);
  if (parsed.success) {
    return { basis: parsed.data.basis, scored: parsed.data.scored, items: unique(parsed.data.items.map(entryOf)) };
  }
  const r = rec(raw);
  if (!Array.isArray(r.items)) return null;
  const items = unique(r.items.map(looseEntry));
  return {
    basis: r.basis === 'description' ? 'description' : 'job',
    scored: typeof r.scored === 'boolean' ? r.scored : items.some((item) => item.total > 0),
    items,
  };
}

// --------------------------------------------------------------------------------------------- the words

/** "9 of 12 keywords · 75%": a resume's numbers, as the Jobs card counts them; null when there is nothing to count. */
export function keywordNumbers(entry: Pick<ResumeMatchEntry, 'matchedCount' | 'total' | 'percentage'>): string | null {
  if (entry.total <= 0) return null;
  return `${entry.matchedCount} of ${entry.total} ${entry.total === 1 ? 'keyword' : 'keywords'} · ${entry.percentage}%`;
}

/**
 * The resume tagged "Best match": the top one of a job that names keywords, unless it fits the job not at all (a fit
 * of 0 claims nothing).
 */
export function bestMatchId(view: ResumeMatchView | null): string | null {
  const top = view?.items[0];
  return view?.scored && top && top.fit > 0 ? top.resumeId : null;
}

/** The ranking is known, and even its top resume fits the job not at all. */
function fitsNothing(view: ResumeMatchView | null): boolean {
  const top = view?.items[0];
  return top !== undefined && top.fit <= 0;
}

export interface DocumentBadge {
  label: string;
  tone: 'tint' | 'outline';
}

/**
 * The linked resume's badges, in order: who chose it, then what it is. "Best match" when TailorIT chose it (unless the
 * ranking shows that no resume fits the job at all), "Chosen by you" when the person did; a link nobody chose (origin
 * null: made by hand without touching the resume, or by an import) claims neither. Then "Default" or "Uploaded".
 */
export function linkedResumeBadges(
  origin: ResumeOrigin | null | undefined,
  resume: { isDefault: boolean; kind: string } | undefined,
  view: ResumeMatchView | null,
): DocumentBadge[] {
  const badges: DocumentBadge[] = [];
  if (origin === 'user') badges.push({ label: CHOSEN_BY_YOU, tone: 'outline' });
  else if (origin === 'auto' && !fitsNothing(view)) badges.push({ label: BEST_MATCH, tone: 'tint' });
  if (resume?.isDefault) badges.push({ label: 'Default', tone: 'outline' });
  else if (resume?.kind === 'uploaded') badges.push({ label: 'Uploaded', tone: 'outline' });
  return badges;
}

/** One option of the resume picker. */
export interface ResumePickerOption {
  id: string;
  label: string;
  isDefault: boolean;
  kind: string;
  /** Tagged "Best match" (see bestMatchId). */
  best: boolean;
  /** "9 of 12 keywords · 75%", or null (the job names no keywords; the plain list). */
  numbers: string | null;
}

/** The picker's options from the ranking: best first, each with its numbers when the job names keywords. */
export function rankedOptions(view: ResumeMatchView): ResumePickerOption[] {
  const best = bestMatchId(view);
  return view.items.map((item) => ({
    id: item.resumeId,
    label: item.label,
    isDefault: item.isDefault,
    kind: item.kind,
    best: item.resumeId === best,
    numbers: view.scored ? keywordNumbers(item) : null,
  }));
}

/** The picker's options from the plain resume list (when the ranking cannot be had): as listed, no numbers. */
export function plainOptions(
  items: ReadonlyArray<{ id: string; label: string; isDefault: boolean; kind: string }>,
): ResumePickerOption[] {
  return items.map((item) => ({ id: item.id, label: item.label, isDefault: item.isDefault, kind: item.kind, best: false, numbers: null }));
}

/** The line under the picker when the resumes carry no numbers: why. Null when they do, or there is no ranking. */
export function pickerHint(view: ResumeMatchView | null): string | null {
  if (!view || view.scored || view.items.length === 0) return null;
  return view.basis === 'description'
    ? 'Add a job description in Overview to compare your resumes with this job.'
    : "This job's posting names no keywords to compare your resumes with.";
}

/**
 * Whether "Let TailorIT choose" is offered: for an application of a job that is Saved and not archived, whose resume
 * TailorIT did not choose (the person's, or none), while no choice is under way and the account has a resume. The
 * server refuses the others (409), so the button never promises what it cannot do.
 */
export function offersAutoMatch(
  application: Pick<ApplicationDetail, 'jobId' | 'currentStatus' | 'archivedAt' | 'resumeId' | 'resumeOrigin' | 'resumeMatchPending'>,
  resumeCount: number,
): boolean {
  if (resumeCount <= 0 || application.resumeMatchPending === true) return false;
  if (application.jobId === null || application.currentStatus !== STATUS.saved || application.archivedAt) return false;
  return application.resumeOrigin !== 'auto' || !application.resumeId;
}

/** The toast once TailorIT chose: its pick by name (when this page knows it), or that there was nothing to pick. */
export function autoMatchedText(resumeId: string | null, label: string | undefined): string {
  if (!resumeId) return 'Add a resume first, then TailorIT can pick one.';
  return label ? `Best match linked: ${label}.` : 'Best match linked to this application.';
}

// ----------------------------------------------------------------------------------------------- polling

/** While TailorIT is still choosing an application's resume, its detail is read again this often... */
export const MATCH_PENDING_POLL_MS = 2_000;
/** ...for this long at most (the match worker links within seconds; a person who comes back later reads it then). */
export const MATCH_PENDING_POLL_FOR_MS = 60_000;

export interface MatchPendingPoll {
  /** The delay before the next read of application `id`'s detail, or false: no read is due. */
  next: (id: string, pending: boolean, now: number) => number | false;
}

/**
 * For React Query's `refetchInterval` of an application's detail: every `everyMs` while its resume is still being
 * chosen (`resumeMatchPending`), until that has been waited for `forMs`; false when nothing is being chosen. Another
 * application starts the wait over.
 */
export function createMatchPendingPoll(everyMs = MATCH_PENDING_POLL_MS, forMs = MATCH_PENDING_POLL_FOR_MS): MatchPendingPoll {
  let waiting: { id: string; since: number } | null = null;
  return {
    next(id, pending, now) {
      if (!pending) {
        waiting = null;
        return false;
      }
      if (!waiting || waiting.id !== id) waiting = { id, since: now };
      return now - waiting.since < forMs ? everyMs : false;
    },
  };
}
