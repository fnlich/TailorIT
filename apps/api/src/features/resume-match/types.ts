import type { ApplicationDetail, ResumeChoiceReason, ResumeMatchList } from '@tailorit/shared';

// The resume match service's contract (work package WP5), on `deps.services.resumeMatch`. Everything here is local
// computation: it never queues AI work. It writes applications only through the full guard (Saved, not archived, linked
// to that job, chosen by TailorIT or not yet, and a resume of the same account), and never touches `updated_at`.

/** The resume TailorIT would link to one job (`chooseForJobs`). */
export interface ResumeChoice {
  jobId: number;
  /** The best match; null when the account has no resume. */
  resumeId: string | null;
  /** Its weighted fit, unrounded 0-100. It only orders resumes and is never shown; null with no resume. */
  fit: number | null;
  /**
   * 'best': it fits best. 'tie': the top fit is shared and the tie-break decided (the default resume, then precision,
   * then the newer last edit, then the id). 'only': the account's one resume. 'none': the account has no resume.
   */
  reason: ResumeChoiceReason;
}

export interface ChooseOptions {
  /** Wall-clock time the call may take; work not reached by then is left for the worker (`unfinished`, `pending`). */
  budgetMs: number;
  /** Stops the call early, as an exhausted budget does. */
  signal?: AbortSignal;
}

export interface ChooseResult {
  /** One choice per job that exists (unknown jobs are left out). */
  choices: Map<number, ResumeChoice>;
  /** Jobs not reached within the budget (or after the signal): write them with resume_match_due = 1. */
  unfinished: number[];
}

export interface EnsureChoicesResult {
  /** Each of the account's applications among the ids: its linked resume after the due ones were chosen. */
  resumeByApplication: Map<string, string | null>;
  /** How many of them are still waiting for their choice (the budget ran out first). */
  pending: number;
}

export interface ResumeMatchService {
  /**
   * The best resume of the account for each job, read-only: nothing is written and no AI is queued. Runs in
   * cooperative slices; jobs past the budget are listed in `unfinished`. Never throws for one job (it is unfinished).
   */
  chooseForJobs(userId: string, jobIds: readonly number[], options: ChooseOptions): Promise<ChooseResult>;
  /** GET /api/applications/:id/resume-matches: every resume of the account, best first (404 for another account's). */
  rank(userId: string, applicationId: string): Promise<ResumeMatchList>;
  /**
   * POST /api/applications/:id/resume-match ("Let TailorIT choose"): the person hands the choice back, TailorIT
   * chooses now (origin 'auto'; none when the account has no resume). Only for an active Saved application of a job:
   * 409 otherwise, 404 for another account's.
   */
  autoMatch(userId: string, applicationId: string): Promise<ApplicationDetail>;
  /**
   * The resume ZIP's choices: the due rows among these applications are chosen first (guarded writes), within the
   * budget; then every one of the account's applications among the ids maps to its linked resume.
   */
  ensureChoices(userId: string, applicationIds: readonly string[], options: ChooseOptions): Promise<EnsureChoicesResult>;
  /**
   * Chooses for every due application (resume_match_due = 1) of every enabled account, in cooperative slices: the
   * worker's pass, and what tests call. Returns how many due rows it settled (linked, or let go as no longer
   * TailorIT's to choose).
   */
  runDue(options?: { budgetMs?: number }): Promise<number>;
  /** Wakes the worker soon (once started), e.g. after writing resume_match_due = 1. Does nothing before `start`. */
  nudge(): void;
}

/** The worker's and the slices' timing (tests shorten it). */
export interface MatchTiming {
  /** The longest a slice of work runs before the event loop gets a turn. */
  sliceMs: number;
  /** The first pass after start. */
  firstRunMs: number;
  /** How often the worker looks for due rows when nothing nudges it. */
  pollMs: number;
  /** A nudge runs a pass this soon. */
  nudgeMs: number;
  /** A row whose choice failed (an error) is tried again this much later. */
  retryFailedMs: number;
}

declare module '../../core/context' {
  interface AppServices {
    /** Choosing the best resume for saved jobs, and keeping the choice current (work package WP5). */
    resumeMatch?: ResumeMatchService;
  }
}
