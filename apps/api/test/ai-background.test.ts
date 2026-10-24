import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundGate, createHourlyBudget, WARNING_PAUSE_MS } from '../src/ai/background';
import { requireAi } from '../src/ai/index';
import { createAiService } from '../src/ai/queue';
import type { AiProvider, ProviderHold, RateLimitReading } from '../src/ai/provider/types';
import { aiTasksFeature } from '../src/features/ai-tasks/index';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

// The shared rules for background AI work (ai/background.ts): the gate that keeps it waiting while the seat needs a
// rest, the hourly budget, and the provider's last usage reading they rely on.

const MINUTE = 60_000;
/** TEST_NOW plus `minutes`, in epoch ms. */
const at = (minutes: number) => TEST_NOW.getTime() + minutes * MINUTE;

let ctx: TestContext | null = null;
afterEach(() => {
  vi.unstubAllEnvs();
  ctx?.cleanup();
  ctx = null;
});

/** A gate over an AI service whose provider never answers; the test sets its holds and its last usage reading. */
function gateWith(options: { readings?: boolean } = {}) {
  const context = createTestContext({ features: [] });
  ctx = context;
  const holds: ProviderHold[] = [];
  let reading: RateLimitReading | null = null;
  const provider: AiProvider = {
    name: 'stub',
    complete: () => Promise.reject(new Error('not used')),
    status: () => Promise.reject(new Error('not used')),
    holdFor: () => null,
    activeHolds: () => holds.filter((hold) => hold.until > context.deps.now().getTime()),
    clearHolds: () => {
      holds.length = 0;
    },
  };
  if (options.readings !== false) provider.lastRateLimit = () => reading;
  context.deps.services.ai = createAiService(context.deps, { provider });
  return {
    gate: createBackgroundGate(context.deps),
    hold: (hold: Omit<ProviderHold, 'kind'> & { kind?: ProviderHold['kind'] }) =>
      holds.push({ kind: 'rateLimited', ...hold }),
    read: (value: Partial<RateLimitReading> | null) => {
      reading = value && { status: 'allowed', resetsAtMs: null, usingOverage: false, seenAtMs: at(0), ...value };
    },
    setMinutes: (minutes: number) => context.setNow(new Date(at(minutes))),
  };
}

describe('the background gate', () => {
  it('is open with no hold and no usage reading', () => {
    const { gate } = gateWith();
    expect(gate.allowed()).toEqual({ ok: true });
  });

  it('stays shut while any hold is active, until the last one ends', () => {
    const { gate, hold, setMinutes } = gateWith();
    hold({ scope: '*', until: at(4), reason: 'the Claude usage limit was reached' });
    hold({ scope: 'cover_letter', until: at(10), kind: 'stalled', reason: 'the CLI gave no output within 30 s' });
    expect(gate.allowed()).toEqual({ ok: false, retryAtMs: at(10), reason: 'the CLI gave no output within 30 s' });
    setMinutes(9);
    expect(gate.allowed()).toMatchObject({ ok: false, retryAtMs: at(10) });
    setMinutes(10);
    expect(gate.allowed()).toEqual({ ok: true });
  });

  it('allowed_warning closes the gate until resetsAt', () => {
    const { gate, read, setMinutes } = gateWith();
    read({ status: 'allowed_warning', resetsAtMs: at(90) });
    expect(gate.allowed()).toEqual({ ok: false, retryAtMs: at(90), reason: 'the Claude usage limit is close' });
    setMinutes(89);
    expect(gate.allowed()).toMatchObject({ ok: false, retryAtMs: at(90) });
    setMinutes(90);
    expect(gate.allowed()).toEqual({ ok: true });
  });

  it('a warning with no reset time keeps it shut for 30 minutes from when it was seen', () => {
    const { gate, read, setMinutes } = gateWith();
    setMinutes(5);
    read({ status: 'allowed_warning', seenAtMs: at(2) });
    expect(WARNING_PAUSE_MS).toBe(30 * MINUTE);
    expect(gate.allowed()).toMatchObject({ ok: false, retryAtMs: at(32) });
    setMinutes(32);
    expect(gate.allowed()).toEqual({ ok: true });
  });

  it("a spent window keeps it shut until the window resets, after the provider's own hold has ended", () => {
    const { gate, hold, read, setMinutes } = gateWith();
    hold({ scope: '*', until: at(30), reason: 'the Claude usage limit was reached' });
    read({ status: 'rejected', resetsAtMs: at(240) });
    const spent = { ok: false, retryAtMs: at(240), reason: 'the Claude usage limit was reached (status "rejected")' };
    expect(gate.allowed()).toEqual(spent);
    setMinutes(31); // the hold is over; the window is not
    expect(gate.allowed()).toEqual(spent);
    setMinutes(240);
    expect(gate.allowed()).toEqual({ ok: true });
  });

  it('paid overage keeps it shut until the window resets', () => {
    const { gate, read } = gateWith();
    read({ status: 'allowed', usingOverage: true, resetsAtMs: at(60) });
    const answer = gate.allowed();
    expect(answer).toEqual({ ok: false, retryAtMs: at(60), reason: 'the Claude CLI reported paid overage use' });
  });

  it('opens for a plain "allowed" reading, a warning whose window has reset, and a provider without readings', () => {
    const open = gateWith();
    open.read({ status: 'allowed', resetsAtMs: at(60) });
    expect(open.gate.allowed()).toEqual({ ok: true });
    open.read({ status: 'allowed_warning', resetsAtMs: at(-1) });
    expect(open.gate.allowed()).toEqual({ ok: true });
    open.read({ status: '' });
    expect(open.gate.allowed()).toEqual({ ok: true });
    ctx?.cleanup();

    const silent = gateWith({ readings: false });
    expect(silent.gate.allowed()).toEqual({ ok: true });
    silent.hold({ scope: '*', until: at(3), reason: 'the CLI is using ANTHROPIC_API_KEY' });
    expect(silent.gate.allowed()).toMatchObject({ ok: false, retryAtMs: at(3) });
  });

  it('stays shut on a server without AI, and looks again in 5 minutes', () => {
    ctx = createTestContext({ features: [] });
    expect(createBackgroundGate(ctx.deps).allowed()).toEqual({
      ok: false,
      retryAtMs: at(5),
      reason: 'AI is not set up on this server',
    });
  });
});

describe('the hourly budget', () => {
  it('allows at most N starts in any rolling hour, and says when the next one may start', () => {
    let now = 0;
    const budget = createHourlyBudget(2, () => now);
    expect(budget.nextAtMs()).toBe(0);
    expect(budget.take()).toBe(true);
    now = 10 * MINUTE;
    expect(budget.take()).toBe(true);
    now = 20 * MINUTE;
    expect(budget.take()).toBe(false);
    expect(budget.take()).toBe(false); // a refusal counts nothing
    expect(budget.nextAtMs()).toBe(60 * MINUTE);
    now = 60 * MINUTE - 1;
    expect(budget.take()).toBe(false);
    now = 60 * MINUTE; // the first start is an hour old
    expect(budget.nextAtMs()).toBe(now);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.nextAtMs()).toBe(70 * MINUTE);
    now = 0; // the clock went back: starts "from the future" are dropped
    expect(budget.take()).toBe(true);
  });

  it('0 means no cap', () => {
    const now = 5 * MINUTE;
    const budget = createHourlyBudget(0, () => now);
    for (let i = 0; i < 500; i += 1) expect(budget.take()).toBe(true);
    expect(budget.nextAtMs()).toBe(now);
  });
});

describe("the provider's last usage reading", () => {
  it('is what the CLI last reported, from answers and failures alike, and the gate follows it', async () => {
    vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
    vi.stubEnv('FAKE_CLAUDE_MODE', '');
    ctx = createTestContext({ features: [aiTasksFeature] });
    const ai = requireAi(ctx.deps);
    const gate = createBackgroundGate(ctx.deps);
    expect(ai.provider.lastRateLimit?.()).toBeNull();

    expect((await ai.test()).ok).toBe(true);
    expect(ai.provider.lastRateLimit?.()).toEqual({
      status: 'allowed',
      resetsAtMs: expect.any(Number),
      usingOverage: false,
      seenAtMs: TEST_NOW.getTime(),
    });
    expect(gate.allowed()).toEqual({ ok: true });

    vi.stubEnv('FAKE_CLAUDE_MODE', 'ratelimit');
    expect((await ai.test()).ok).toBe(false);
    const reading = ai.provider.lastRateLimit?.();
    expect(reading).toMatchObject({ status: 'rejected', resetsAtMs: expect.any(Number), usingOverage: false });
    // Shut until the later of the provider's hold (at most 30 minutes) and the window's reset.
    const holdUntil = Math.max(...ai.provider.activeHolds().map((hold) => hold.until));
    expect(gate.allowed()).toMatchObject({ ok: false, retryAtMs: Math.max(holdUntil, reading!.resetsAtMs!) });
  });
});
