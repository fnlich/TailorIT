import type { AppDeps } from '../core/context';
import type { RateLimitReading } from './provider/types';
import type { AiService } from './queue';

// Shared rules for background AI work: the backlogs that have Claude read each upload (resume_analysis) and each added
// job (job_analysis) on the background slot. They start work only while the seat has room to spare, so they never
// trip the usage pause that would turn away people's own AI requests:
//   - the gate stays shut while any hold is active, and while the CLI's last usage reading is not plain "allowed"
//     (e.g. "allowed_warning": the window is nearly used up), until that window resets;
//   - an hourly budget caps how many tasks a backlog starts (AI_RESUME_ANALYSIS_PER_HOUR, AI_JOB_ANALYSIS_PER_HOUR).
// Both only answer questions; the workers decide what to do (wait until `retryAtMs` or `nextAtMs()`).

/** How long a usage warning that gives no reset time keeps background work waiting, from when it was seen. */
export const WARNING_PAUSE_MS = 30 * 60_000;
/** A server without an AI service looks again this much later. */
const NO_AI_RETRY_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

export type GateAnswer = { ok: true } | { ok: false; retryAtMs: number; reason: string };

export interface BackgroundGate {
  /** Whether background AI work may start a task now; if not, when to look again (epoch ms) and why, for logs. */
  allowed(): GateAnswer;
}

/** Until when a usage reading keeps background work waiting (epoch ms); 0 when it does not. */
function readingPausesUntil(reading: RateLimitReading): number {
  if (!reading.usingOverage && (reading.status === '' || reading.status === 'allowed')) return 0;
  return reading.resetsAtMs ?? reading.seenAtMs + WARNING_PAUSE_MS;
}

function readingReason(reading: RateLimitReading): string {
  if (reading.usingOverage) return 'the Claude CLI reported paid overage use';
  if (reading.status === 'allowed_warning') return 'the Claude usage limit is close';
  return `the Claude usage limit was reached (status "${reading.status}")`;
}

/** The gate every background AI worker asks before it starts a task. Reads the AI service at each call. */
export function createBackgroundGate(deps: Pick<AppDeps, 'services' | 'now'>): BackgroundGate {
  return {
    allowed() {
      const nowMs = deps.now().getTime();
      const ai: AiService | undefined = deps.services.ai;
      if (!ai) return { ok: false, retryAtMs: nowMs + NO_AI_RETRY_MS, reason: 'AI is not set up on this server' };
      let until = nowMs;
      let reason = '';
      // Any hold: a stall or a spent window held for one feature is a sign the seat needs a rest too.
      for (const hold of ai.provider.activeHolds()) {
        if (hold.until > until) {
          until = hold.until;
          reason = hold.reason;
        }
      }
      const reading = ai.provider.lastRateLimit?.() ?? null;
      if (reading) {
        const pausedUntil = readingPausesUntil(reading);
        if (pausedUntil > until) {
          until = pausedUntil;
          reason = readingReason(reading);
        }
      }
      return until > nowMs ? { ok: false, retryAtMs: until, reason } : { ok: true };
    },
  };
}

export interface HourlyBudget {
  /** Counts one task when the last hour has room for it, and says so; false (nothing counted) when it has not. */
  take(): boolean;
  /** When `take()` can next succeed (epoch ms): now when it already can. */
  nextAtMs(): number;
}

/**
 * At most `perHour` takes in any rolling hour; 0 means no cap. Counted in memory, so a restart starts afresh (the gate
 * and each backlog's one task in flight still apply). `now` is epoch ms.
 */
export function createHourlyBudget(perHour: number, now: () => number): HourlyBudget {
  let taken: number[] = [];
  /** The takes of the last hour, oldest first. One "after" now means the clock went back: it is dropped. */
  const lastHour = (at: number) => (taken = taken.filter((t) => t > at - HOUR_MS && t <= at));
  return {
    take() {
      if (perHour <= 0) return true;
      const at = now();
      if (lastHour(at).length >= perHour) return false;
      taken.push(at);
      return true;
    },
    nextAtMs() {
      const at = now();
      if (perHour <= 0) return at;
      const recent = lastHour(at);
      return recent.length < perHour ? at : recent[0]! + HOUR_MS;
    },
  };
}
