import { getConfig, type AppConfig } from './config/env';
import type { AppDeps } from './core/context';
import { openDatabase } from './core/db/connection';
import { migrate } from './core/db/migrate';
import { createLogger } from './core/log';

/** Opens the database, applies migrations and builds the dependency bag shared by the server and the CLI. */
export function createRuntimeDeps(config: AppConfig = getConfig()): AppDeps {
  const log = createLogger(config.logLevel);
  const db = openDatabase(config.dataDir);
  const { applied } = migrate(db);
  if (applied.length) log.info(`[api] applied migrations: ${applied.join(', ')}`);
  return { db, config, log, now: () => new Date(), services: {} };
}
