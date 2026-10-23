#!/usr/bin/env node
// `npm run dev`: the API (tsx watch) and the web app (Next dev) side by side, with the root `.env` loaded.
// `npm run dev:webpack` starts Next with webpack instead of Turbopack.
// Ctrl-C (or either server exiting) stops both, including their child processes.
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadRootEnv, repoRoot } from './env.mjs';
import { killTree, paint, runNode } from './proc.mjs';

loadRootEnv();

const useWebpack = process.argv.includes('--webpack');
const require = createRequire(join(repoRoot, 'package.json'));
const tsxCli = require.resolve('tsx/cli');

const children = [];
let stopping = false;

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(exitCode), 300);
}

function watch(name, child) {
  children.push(child);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(paint('red', `[dev] ${name} exited (${signal ?? code}); stopping the other server.`));
    stop(code ?? 1);
  });
}

console.log(
  paint(
    'gray',
    `[dev] web http://localhost:${process.env.WEB_PORT || 3100}  api http://127.0.0.1:${process.env.API_PORT || 4100}`,
  ),
);

watch(
  'api',
  runNode('api', 'cyan', [tsxCli, 'watch', '--clear-screen=false', 'src/index.ts'], {
    cwd: join(repoRoot, 'apps', 'api'),
  }),
);
watch(
  'web',
  runNode('web', 'magenta', [join(repoRoot, 'scripts', 'next-launch.mjs'), useWebpack ? 'dev-webpack' : 'dev'], {
    cwd: join(repoRoot, 'apps', 'web'),
  }),
);

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
