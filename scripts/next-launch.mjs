#!/usr/bin/env node
// Runs Next for apps/web with the root `.env` loaded.
//
// Why a launcher (lessons from free_tailor's frontend/scripts/next.mjs):
// - npm runs scripts through cmd.exe on Windows, so `--port ${WEB_PORT:-3100}` would reach Next literally.
// - Next only reads `.env` files from its own directory; TailorIT keeps one `.env` at the repository root.
// - On Windows, Turbopack's `next dev` can die natively (0xC0000005) shortly after "Ready". `dev` then restarts once
//   with webpack's dev server (`next dev --webpack`).
// - Next listens on every network interface unless told otherwise, and in development AUTH_DEV_FIXED_CODE signs anyone
//   in as anyone: the server listens on WEB_HOST, by default this computer only.
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
// "localhost" means 127.0.0.1: Node binds a host name to its first address only, ::1 on Windows, which would leave
// http://127.0.0.1:<port> refused; browsers opening http://localhost:<port> fall back to 127.0.0.1 by themselves.
const hostSetting = process.env.WEB_HOST?.trim() || 'localhost';
const host = hostSetting.toLowerCase() === 'localhost' ? '127.0.0.1' : hostSetting;
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|\[::1\])$/;

// Windows reports an access violation either unsigned or as the signed int32 of 0xC0000005.
const ACCESS_VIOLATION = new Set([3221225477, -1073741819]);

function argsFor(nextArgs) {
  return nextArgs[0] === 'build' ? nextArgs : [...nextArgs, '--port', port, '--hostname', host];
}

if (mode !== 'build' && !LOOPBACK.test(host)) {
  // The API ignores the fixed code in production (NODE_ENV=production, which `npm start` sets).
  const fixedCode = Boolean(process.env.AUTH_DEV_FIXED_CODE?.trim()) && process.env.NODE_ENV !== 'production';
  console.warn(
    paint(
      fixedCode ? 'red' : 'yellow',
      `[next] WEB_HOST=${hostSetting}: the web server can be reached from other computers on the network.` +
        (fixedCode
          ? '\n[next] AUTH_DEV_FIXED_CODE is set, so anyone on the network can sign in as any address, administrators ' +
            'included. Clear AUTH_DEV_FIXED_CODE, or set WEB_HOST=localhost.'
          : ''),
    ),
  );
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
