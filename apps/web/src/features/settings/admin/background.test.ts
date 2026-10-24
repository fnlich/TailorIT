import { describe, expect, it } from 'vitest';
import type { AiBackgroundWork } from '@tailorit/shared/ai';
import { clockTime, gateLine, gateTone, jobsRow, matchesRow, resumesRow } from './background';

// The words of Admin › AI › Background work (GET /api/admin/ai/background).

const JOBS: AiBackgroundWork['jobs'] = { mode: 'ingest', waiting: 1234, backingOff: 0, gaveUp: 0, perHourCap: 0 };
const RESUMES: AiBackgroundWork['resumes'] = { mode: 'auto', waiting: 4, queued: 0, failed: 0, perHourCap: 20 };
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

/** Intl puts a narrow no-break space before AM/PM; compare it as a plain space. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('Background work rows', () => {
  it('jobs: the count, the backoff parts that are not 0, and how the backlog runs', () => {
    expect(jobsRow(JOBS)).toEqual({
      key: 'jobs',
      title: 'Jobs waiting for Claude: 1,234',
      detail: '',
      note: 'Every added job, newest first. No hourly cap.',
    });
    expect(jobsRow({ ...JOBS, backingOff: 3, gaveUp: 1, perHourCap: 60 })).toMatchObject({
      detail: '3 backing off · 1 given up',
      note: 'Every added job, newest first. Capped at 60 an hour.',
    });
    expect(jobsRow({ ...JOBS, gaveUp: 2 }).detail).toBe('2 given up');
    expect(jobsRow({ ...JOBS, backingOff: 1500 }).detail).toBe('1,500 backing off');
    expect(jobsRow({ ...JOBS, mode: 'saved', perHourCap: 1000 }).note).toBe('Saved jobs only, newest first. Capped at 1,000 an hour.');
    // Modes without a backlog say how Claude reads jobs instead, with no cap.
    expect(jobsRow({ ...JOBS, mode: 'lazy', waiting: 0, perHourCap: 5 })).toMatchObject({
      title: 'Jobs waiting for Claude: 0',
      note: 'Claude reads a job the first time someone opens it (AI_JOB_ANALYSIS=lazy).',
    });
    expect(jobsRow({ ...JOBS, mode: 'off', waiting: 0 }).note).toBe('Claude does not read jobs (AI_JOB_ANALYSIS=off).');
  });

  it('resumes: the count, queued and failed when not 0, and the hourly cap', () => {
    expect(resumesRow(RESUMES)).toEqual({
      key: 'resumes',
      title: 'Resumes waiting for Claude: 4',
      detail: '',
      note: 'Each uploaded resume, one at a time, before any job. Capped at 20 an hour.',
    });
    expect(resumesRow({ ...RESUMES, queued: 1, failed: 2, perHourCap: 0 })).toMatchObject({
      detail: '1 queued · 2 failed',
      note: 'Each uploaded resume, one at a time, before any job. No hourly cap.',
    });
    expect(resumesRow({ ...RESUMES, failed: 3 }).detail).toBe('3 failed');
    expect(resumesRow({ ...RESUMES, mode: 'off', waiting: 0 }).note).toBe('Claude does not read uploaded resumes (AI_RESUME_ANALYSIS=off).');
  });

  it('matches: the Saved applications whose resume is chosen again', () => {
    expect(matchesRow({ due: 2 })).toEqual({
      key: 'matches',
      title: 'Resume matches to update: 2',
      detail: '',
      note: 'Saved jobs whose best-matched resume TailorIT chooses again, on this server, without Claude.',
    });
    expect(matchesRow({ due: 12000 }).title).toBe('Resume matches to update: 12,000');
  });

  it('never uses an em dash', () => {
    const rows = [
      jobsRow({ ...JOBS, backingOff: 1, gaveUp: 1 }),
      jobsRow({ ...JOBS, mode: 'lazy' }),
      resumesRow({ ...RESUMES, queued: 1, failed: 1 }),
      matchesRow({ due: 1 }),
    ];
    const EM_DASH = String.fromCharCode(0x2014);
    expect(rows.flatMap((row) => [row.title, row.detail, row.note]).join(' ')).not.toContain(EM_DASH);
  });
});

describe('the background gate', () => {
  it('reads "Running" while open', () => {
    expect(gateLine({ open: true, reason: null, retryAt: null }, NOW, 'UTC')).toBe('Running');
    expect(gateTone({ open: true, reason: null, retryAt: null })).toBe('running');
  });

  it('reads "Paused until {time}: {reason}" while a hold or a usage warning keeps it shut', () => {
    const hold = { open: false, reason: 'the Claude usage limit is close', retryAt: '2026-10-22T15:45:00.000Z' };
    expect(plain(gateLine(hold, NOW, 'UTC'))).toBe('Paused until 3:45 PM: the Claude usage limit is close');
    expect(gateTone(hold)).toBe('paused');
    // Another day: the date too.
    expect(plain(gateLine({ ...hold, retryAt: '2026-10-23T09:05:00.000Z' }, NOW, 'UTC'))).toBe(
      'Paused until Oct 23, 9:05 AM: the Claude usage limit is close',
    );
    expect(plain(gateLine({ ...hold, reason: null }, NOW, 'UTC'))).toBe('Paused until 3:45 PM');
  });

  it('reads "Paused: {reason}" while a setting keeps background work off', () => {
    const off = { open: false, reason: 'AI is turned off (AI_ENABLED=false)', retryAt: null };
    expect(gateLine(off, NOW, 'UTC')).toBe('Paused: AI is turned off (AI_ENABLED=false)');
    expect(gateTone(off)).toBe('off');
  });

  it('shows times in the given time zone, with the date when it is not the same day there', () => {
    expect(plain(clockTime('2026-10-22T15:45:00.000Z', NOW, 'America/Chicago'))).toBe('10:45 AM');
    // 01:30 UTC on Oct 23 is still Oct 22 in Chicago, as is NOW.
    expect(plain(clockTime('2026-10-23T01:30:00.000Z', NOW, 'America/Chicago'))).toBe('8:30 PM');
    expect(plain(clockTime('2026-10-23T01:30:00.000Z', NOW, 'UTC'))).toBe('Oct 23, 1:30 AM');
    expect(clockTime('not a time', NOW, 'UTC')).toBe('not a time');
  });
});
