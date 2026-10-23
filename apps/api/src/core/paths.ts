import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Locations inside the repository. Resolved by walking up from this module, so they work both from source (tsx,
// vitest) and from the tsup bundle in apps/api/dist.

function findUp(start: string, predicate: (dir: string) => boolean): string {
  let dir = start;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the TailorIT directory above ${start}`);
    dir = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));

let apiRootCache: string | null = null;
/** apps/api */
export function apiRoot(): string {
  apiRootCache ??= findUp(here, (dir) => {
    const pkg = join(dir, 'package.json');
    return existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === '@tailorit/api';
  });
  return apiRootCache;
}

/** The repository root (holds the single `.env`). */
export function repoRoot(): string {
  return join(apiRoot(), '..', '..');
}

/** apps/api/migrations */
export function migrationsDir(): string {
  return join(apiRoot(), 'migrations');
}

/** apps/api/static (templates, skills, taxonomy, seed, fonts...) */
export function staticDir(...parts: string[]): string {
  return join(apiRoot(), 'static', ...parts);
}
