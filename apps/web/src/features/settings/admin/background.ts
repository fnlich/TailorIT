import type { AiBackgroundWork, AiJobAnalysisMode } from '@tailorit/shared/ai';

// The words of Admin › AI › Background work (pure, so the web unit tests can import it).

/** How often the card reads the counts again while the AI tab is open. */
export const BACKGROUND_REFRESH_MS = 30_000;

/** One row of the card: its count, the parts of it worth a word ('' when there are none), and how that work runs. */
export interface BackgroundRow {
  key: 'jobs' | 'resumes' | 'matches';
  title: string;
  detail: string;
  note: string;
}

const count = (value: number) => value.toLocaleString('en-US');

/** "3 backing off · 1 given up": the parts that are not 0. */
function partsLine(parts: ReadonlyArray<readonly [number, string]>): string {
  return parts
    .filter(([value]) => value > 0)
    .map(([value, label]) => `${count(value)} ${label}`)
    .join(' · ');
}

const capLine = (perHourCap: number) => (perHourCap > 0 ? `Capped at ${count(perHourCap)} an hour.` : 'No hourly cap.');

const JOB_MODE_LINE: Record<AiJobAnalysisMode, string> = {
  ingest: 'Every added job, newest first.',
  saved: 'Saved jobs only, newest first.',
  lazy: 'Claude reads a job the first time someone opens it (AI_JOB_ANALYSIS=lazy).',
  off: 'Claude does not read jobs (AI_JOB_ANALYSIS=off).',
};

/** "Jobs waiting for Claude: 1,234", "3 backing off · 1 given up", "Every added job, newest first. No hourly cap." */
export function jobsRow(jobs: AiBackgroundWork['jobs']): BackgroundRow {
  const backlog = jobs.mode === 'ingest' || jobs.mode === 'saved';
  return {
    key: 'jobs',
    title: `Jobs waiting for Claude: ${count(jobs.waiting)}`,
    detail: partsLine([
      [jobs.backingOff, 'backing off'],
      [jobs.gaveUp, 'given up'],
    ]),
    note: backlog ? `${JOB_MODE_LINE[jobs.mode]} ${capLine(jobs.perHourCap)}` : JOB_MODE_LINE[jobs.mode],
  };
}

/** "Resumes waiting for Claude: 4", "1 queued · 2 failed", and how uploads are read. */
export function resumesRow(resumes: AiBackgroundWork['resumes']): BackgroundRow {
  return {
    key: 'resumes',
    title: `Resumes waiting for Claude: ${count(resumes.waiting)}`,
    detail: partsLine([
      [resumes.queued, 'queued'],
      [resumes.failed, 'failed'],
    ]),
    note:
      resumes.mode === 'auto'
        ? `Each uploaded resume, one at a time, before any job. ${capLine(resumes.perHourCap)}`
        : 'Claude does not read uploaded resumes (AI_RESUME_ANALYSIS=off).',
  };
}

/** "Resume matches to update: 2": Saved jobs whose best-matched resume is chosen again (no AI). */
export function matchesRow(matches: AiBackgroundWork['matches']): BackgroundRow {
  return {
    key: 'matches',
    title: `Resume matches to update: ${count(matches.due)}`,
    detail: '',
    note: 'Saved jobs whose best-matched resume TailorIT chooses again, on this server, without Claude.',
  };
}

/**
 * "3:45 PM" on the day of `now`, "Oct 23, 3:45 PM" on another day: in the browser's time zone, or `timeZone` (tests).
 * An unreadable time is returned as it came.
 */
export function clockTime(iso: string, now: number, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const day = (date: Date) => date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone });
  if (day(at) === day(new Date(now))) return time;
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}, ${time}`;
}

/**
 * The background gate in a line: "Running", "Paused until 3:45 PM: the Claude usage limit is close", or, while a
 * setting keeps background work off (no end time), "Paused: AI is turned off (AI_ENABLED=false)".
 */
export function gateLine(gate: AiBackgroundWork['gate'], now: number, timeZone?: string): string {
  if (gate.open) return 'Running';
  const until = gate.retryAt ? ` until ${clockTime(gate.retryAt, now, timeZone)}` : '';
  return `Paused${until}${gate.reason ? `: ${gate.reason}` : ''}`;
}

/** The status dot: green while running, amber while paused for a while, grey while a setting keeps it off. */
export function gateTone(gate: AiBackgroundWork['gate']): 'running' | 'paused' | 'off' {
  return gate.open ? 'running' : gate.retryAt ? 'paused' : 'off';
}
