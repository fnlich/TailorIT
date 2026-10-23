import { afterEach, describe, expect, it } from 'vitest';
import { requireAi } from '../src/ai/index';
import { aiTasksFeature } from '../src/features/ai-tasks/index';
import { createTestContext, type TestContext } from './helpers';

// One tiny real prompt through the installed, signed-in `claude` (the operator's subscription seat), to prove the
// argv, the .cmd shim resolution and the stream parsing work end to end. Skipped unless asked for:
//   TAILORIT_REAL_CLAUDE=1 npx vitest run --project api test/ai-real.test.ts

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('the real Claude CLI', () => {
  it.runIf(process.env.TAILORIT_REAL_CLAUDE === '1')(
    'is signed in on a subscription and answers a one-line JSON echo on claude-sonnet-5-5',
    async () => {
      ctx = createTestContext({
        features: [aiTasksFeature],
        env: { AI_CLI_BIN: process.env.AI_CLI_BIN_REAL || 'claude', AI_CLI_MODEL: 'claude-sonnet-5-5' },
      });
      const ai = requireAi(ctx.deps);
      const health = await ai.health(true);
      console.log(`[real claude] health: ${health.message}`);
      expect(health).toMatchObject({ available: true, loggedIn: true });

      const result = await ai.test();
      console.log(`[real claude] test: ${JSON.stringify(result)}`);
      expect(result.ok).toBe(true);
      expect(result.answer?.toLowerCase()).toContain('pong');
    },
    150_000,
  );
});
