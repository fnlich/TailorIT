import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

function applyPragmas(db: Db, { wal }: { wal: boolean }): void {
  if (wal) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
}

/** Opens (creating if needed) the TailorIT database at `<dataDir>/tailorit.db`. */
export function openDatabase(dataDir: string): Db {
  const file = join(dataDir, 'tailorit.db');
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  applyPragmas(db, { wal: true });
  return db;
}

/** An in-memory database with the same pragmas (tests). */
export function openMemoryDatabase(): Db {
  const db = new Database(':memory:');
  applyPragmas(db, { wal: false });
  return db;
}

/**
 * Runs `fn` in an IMMEDIATE transaction (takes the write lock up front, so two writers never deadlock on upgrade).
 * Nested calls join the outer transaction.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.inTransaction) return fn();
  return db.transaction(fn).immediate();
}

/**
 * Runs `fn` in a savepoint (better-sqlite3 nests transactions that way; a fresh IMMEDIATE transaction when none is
 * open), so a write that fails here leaves the caller's transaction as it was.
 */
export function savepoint<T>(db: Db, fn: () => T): T {
  const run = db.transaction(fn);
  return db.inTransaction ? run() : run.immediate();
}
