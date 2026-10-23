#!/usr/bin/env node
// `npm start`: the production build of both apps (run `npm run build` first).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRootEnv, repoRoot } from './env.mjs';
import { killTree, paint, runNode } from './proc.mjs';

loadRootEnv();
process.env.NODE_ENV ??= 'production';

const apiEntry = join(repoRoot, 'apps', 'api', 'dist', 'index.js');
if (!existsSync(apiEntry) || !existsSync(join(repoRoot, 'apps', 'web', '.next'))) {
  console.error(paint('red', '[start] No production build found. Run `npm run build` first.'));
  process.exit(1);
}

const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 300);
}

for (const [name, color, args, cwd] of [
  ['api', 'cyan', [apiEntry], join(repoRoot, 'apps', 'api')],
  ['web', 'magenta', [join(repoRoot, 'scripts', 'next-launch.mjs'), 'start'], join(repoRoot, 'apps', 'web')],
]) {
  const child = runNode(name, color, args, { cwd });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(paint('red', `[start] ${name} exited (${signal ?? code}).`));
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
