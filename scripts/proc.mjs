// Small process helpers shared by the launchers.
import { spawn, spawnSync } from 'node:child_process';

const COLORS = { cyan: 36, magenta: 35, yellow: 33, gray: 90, red: 31, green: 32 };

export function paint(color, text) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\u001b[${COLORS[color] ?? 0}m${text}\u001b[0m`;
}

/** Ends a child and everything it started. On Windows a plain kill leaves grandchildren (Next, tsx) running. */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Spawns `node <args>` with each output line prefixed by a coloured name. */
export function runNode(name, color, args, { cwd, env = process.env } = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const label = paint(color, `[${name}]`);
  const pipe = (stream, target) => {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) target.write(`${label} ${line}\n`);
    });
    stream.on('end', () => {
      if (buffered) target.write(`${label} ${buffered}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}
