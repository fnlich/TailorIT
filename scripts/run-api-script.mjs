#!/usr/bin/env node
// Runs an API maintenance command (apps/api/src/cli.ts) with the root `.env` loaded.
// Usage: node scripts/run-api-script.mjs <command> [...args]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadRootEnv, repoRoot } from './env.mjs';

loadRootEnv();
const require = createRequire(join(repoRoot, 'package.json'));
const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/cli.ts', ...process.argv.slice(2)], {
  cwd: join(repoRoot, 'apps', 'api'),
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
