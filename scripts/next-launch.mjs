#!/usr/bin/env node
// Runs Next for apps/web with the root `.env` loaded.
//
// Why a launcher (lessons from free_tailor's frontend/scripts/next.mjs):
// - npm runs scripts through cmd.exe on Windows, so `--port ${WEB_PORT:-3100}` would reach Next literally.
// - Next only reads `.env` files from its own directory; TailorIT keeps one `.env` at the repository root.
// - On Windows, Turbopack's `next dev` can die natively (0xC0000005) shortly after "Ready". `dev` then restarts once
//   with webpack's dev server (`next dev --webpack`).
//
// Usage: node scripts/next-launch.mjs <dev|dev-webpack|build|start>
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadRootEnv, repoRoot } from './env.mjs';
import { paint } from './proc.mjs';

loadRootEnv();

const MODES = {
  dev: ['dev'],
  'dev-webpack': ['dev', '--webpack'],
  build: ['build'],
  start: ['start'],
};

const mode = process.argv[2];
if (!MODES[mode]) {
  console.error(`usage: node scripts/next-launch.mjs <${Object.keys(MODES).join('|')}>`);
  process.exit(2);
}

const webDir = join(repoRoot, 'apps', 'web');
const require = createRequire(join(webDir, 'package.json'));
const nextBin = require.resolve('next/dist/bin/next');
const port = process.env.WEB_PORT || '3100';

// Windows reports an access violation either unsigned or as the signed int32 of 0xC0000005.
const ACCESS_VIOLATION = new Set([3221225477, -1073741819]);

function argsFor(nextArgs) {
  return nextArgs[0] === 'build' ? nextArgs : [...nextArgs, '--port', port];
}

function run(nextArgs, { allowFallback }) {
  const child = spawn(process.execPath, [nextBin, ...argsFor(nextArgs)], {
    cwd: webDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  const forward = (signal) => child.kill(signal);
  process.once('SIGINT', forward);
  process.once('SIGTERM', forward);
  child.on('exit', (code, signal) => {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
    if (allowFallback && process.platform === 'win32' && signal == null && ACCESS_VIOLATION.has(code)) {
      console.error(
        paint(
          'yellow',
          `[next] Turbopack's dev server crashed natively (exit ${code}, 0xC0000005, vercel/next.js#95015).\n` +
            '[next] Restarting once with webpack: next dev --webpack. To choose webpack yourself: npm run dev:webpack',
        ),
      );
      run(MODES['dev-webpack'], { allowFallback: false });
      return;
    }
    process.exit(signal ? 1 : (code ?? 1));
  });
}

run(MODES[mode], { allowFallback: mode === 'dev' });
