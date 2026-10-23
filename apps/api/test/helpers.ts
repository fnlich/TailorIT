import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp, setupServices } from '../src/app';
import { buildConfig } from '../src/config/env';
import type { AppDeps } from '../src/core/context';
import { openMemoryDatabase } from '../src/core/db/connection';
import { migrate } from '../src/core/db/migrate';
import type { Feature } from '../src/core/feature';
import { createMemoryLogger } from '../src/core/log';
import { repoRoot } from '../src/core/paths';
import { FEATURES } from '../src/features/index';

/** The deterministic `claude` stand-in (tools/fake-claude). */
export const FAKE_CLAUDE = join(repoRoot(), 'tools', 'fake-claude', 'fake-claude.mjs');

/** Frozen "now" for tests: the date of the user's screenshots. */
export const TEST_NOW = new Date('2026-10-22T12:00:00.000Z');

/** The origin browsers send through the Next proxy; use it on mutating requests. */
export const ORIGIN = 'http://localhost:3100';

export interface TestContext {
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  /** A cookie-keeping client (sign in once, then call as that account). */
  agent: ReturnType<typeof request.agent>;
  dataDir: string;
  setNow(date: Date): void;
  cleanup(): void;
}

/**
 * An app over an in-memory, migrated database, a temporary DATA_DIR, a frozen clock and the fake Claude CLI.
 * `env` overrides any .env setting (the real .env is never read).
 */
export function createTestContext(
  options: { env?: Record<string, string>; now?: Date; features?: Feature[] } = {},
): TestContext {
  const dataDir = mkdtempSync(join(tmpdir(), 'tailorit-test-'));
  const config = buildConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    APP_ORIGIN: ORIGIN,
    AI_CLI_BIN: FAKE_CLAUDE,
    AUTH_DEV_LOG_CODES: 'false',
    AUTH_DEV_FIXED_CODE: '000000',
    INGEST_ENABLED: 'false',
    ...options.env,
  });
  const db = openMemoryDatabase();
  migrate(db);
  let current = options.now ?? TEST_NOW;
  const deps: AppDeps = { db, config, log: createMemoryLogger(), now: () => current, services: {} };
  const features = options.features ?? FEATURES;
  setupServices(deps, features);
  const app = createApp(deps, features);
  return {
    deps,
    app,
    agent: request.agent(app),
    dataDir,
    setNow(date: Date) {
      current = date;
    },
    cleanup() {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
