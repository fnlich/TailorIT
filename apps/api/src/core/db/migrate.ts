import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrationsDir } from '../paths';
import type { Db } from './connection';

// Forward-only SQL migrations: apps/api/migrations/NNNN_name.sql, applied in order, each in its own transaction and
// recorded with a checksum. A recorded migration whose file has since changed refuses startup — edit the schema with a
// NEW migration instead. Version ranges are reserved per work package (see docs/ARCHITECTURE.md): 0001 init,
// R1 01xx, C 02xx, T 03xx, J1 04xx, J2 05xx, I 06xx.

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function readMigrations(dir = migrationsDir()): MigrationFile[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => FILE_PATTERN.test(f))
    .sort();
  const seen = new Set<number>();
  return files.map((file) => {
    const [, version, name] = FILE_PATTERN.exec(file)!;
    const v = Number(version);
    if (seen.has(v)) throw new Error(`Two migrations share version ${version} (${file}).`);
    seen.add(v);
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    return { version: v, name: name!, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

export function migrate(db: Db, files = readMigrations()): { applied: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const recorded = new Map(
    (db.prepare('SELECT version, name, checksum FROM schema_migrations').all() as {
      version: number;
      name: string;
      checksum: string;
    }[]).map((row) => [row.version, row]),
  );
  const applied: string[] = [];
  for (const file of files) {
    const existing = recorded.get(file.version);
    if (existing) {
      if (existing.checksum !== file.checksum) {
        throw new Error(
          `Migration ${String(file.version).padStart(4, '0')}_${file.name}.sql changed after it was applied. ` +
            'Restore the original file and put schema changes in a new migration.',
        );
      }
      continue;
    }
    db.transaction(() => {
      db.exec(file.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        file.version,
        file.name,
        file.checksum,
        new Date().toISOString(),
      );
    }).immediate();
    applied.push(`${String(file.version).padStart(4, '0')}_${file.name}`);
  }
  return { applied };
}
