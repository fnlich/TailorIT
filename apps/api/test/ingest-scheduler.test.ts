import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyPattern, startIngestSchedule } from '../src/features/ingest/scheduler';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  vi.useRealTimers();
  ctx?.cleanup();
  ctx = null;
});

describe('daily ingest schedule', () => {
  it('turns HH:MM into a cron pattern', () => {
    expect(dailyPattern('03:30')).toBe('30 3 * * *');
    expect(dailyPattern('7:05')).toBe('5 7 * * *');
    expect(() => dailyPattern('25:00')).toThrow(/HH:MM/);
  });

  it('runs every daily source at INGEST_DAILY_AT in INGEST_TIMEZONE, once a day, until stopped', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-22T03:29:00.000Z') });
    ctx = createTestContext({ env: { INGEST_ENABLED: 'true', INGEST_DAILY_AT: '03:30', INGEST_TIMEZONE: 'UTC' } });
    const runScheduled = vi.fn(async () => []);
    const schedule = startIngestSchedule(ctx.deps, { runScheduled });
    expect(schedule.nextRun()?.toISOString()).toBe('2026-10-22T03:30:00.000Z');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(runScheduled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runScheduled).toHaveBeenCalledTimes(1);
    expect(runScheduled).toHaveBeenLastCalledWith('schedule');
    expect(schedule.nextRun()?.toISOString()).toBe('2026-10-23T03:30:00.000Z');

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(runScheduled).toHaveBeenCalledTimes(2);

    schedule.stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60_000);
    expect(runScheduled).toHaveBeenCalledTimes(2);
  });

  it('does nothing when INGEST_ENABLED=false', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-22T03:29:00.000Z') });
    ctx = createTestContext({ env: { INGEST_ENABLED: 'false', INGEST_TIMEZONE: 'UTC' } });
    const runScheduled = vi.fn(async () => []);
    const schedule = startIngestSchedule(ctx.deps, { runScheduled });
    expect(schedule.nextRun()).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60_000);
    expect(runScheduled).not.toHaveBeenCalled();
  });
});
