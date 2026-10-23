import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../core/paths';

/**
 * Turns AI_CLI_BIN into something `spawn` runs WITHOUT a shell. npm installs `claude` on Windows as a `.cmd` shim,
 * which spawn cannot execute directly, and `shell: true` would hand the admin-editable system prompt on the command
 * line to cmd.exe to re-parse. So the shim is read and its target run instead: a native `.exe` directly, a `.js`
 * script under this same Node. Scripts named directly (the test double `tools/fake-claude/fake-claude.mjs`) also run
 * under `process.execPath`, on every platform. A relative path is tried against the working directory, then the
 * repository root (where `.env` lives), and always made absolute: the child runs in its own empty directory.
 */

export interface CliCommand {
  command: string;
  /** Arguments that precede the CLI's own (the script path for a Node script). */
  prefixArgs: string[];
  /** The file that was found (the shim itself for a shim), for messages. */
  resolvedFrom: string;
}

export interface ResolveHost {
  platform: NodeJS.Platform;
  pathEnv: string;
  pathExt: string;
  execPath: string;
  cwd: string;
  rootDir: string;
  isFile(file: string): boolean;
  readText(file: string): string;
}

export function defaultResolveHost(): ResolveHost {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? process.env.Path ?? '',
    pathExt: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    execPath: process.execPath,
    cwd: process.cwd(),
    rootDir: repoRoot(),
    isFile: (file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    },
    readText: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    },
  };
}

export class CliNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliNotFoundError';
  }
}

const SCRIPT = new Set(['.js', '.mjs', '.cjs']);
const NATIVE = new Set(['.exe', '.com']);

/** The program an npm shim (`.cmd`, `.ps1` or the extensionless sh script) runs: a script beats `node.exe`, which is
 *  only its interpreter; otherwise the first native executable it names. */
function shimTarget(shim: string, host: ResolveHost, p: path.PlatformPath): CliCommand | null {
  const base = shim.slice(0, shim.length - p.extname(shim).length);
  for (const file of [shim, `${base}.cmd`, `${base}.ps1`, base]) {
    const text = host.readText(file);
    if (!text) continue;
    const targets = [...text.matchAll(/(?:%~?dp0%?|\$basedir)[\\/]*([^"'\s%*]+)/g)].map((m) =>
      p.resolve(p.dirname(file), m[1]!.split(/[\\/]/).join(p.sep)),
    );
    const script = targets.find((t) => SCRIPT.has(p.extname(t).toLowerCase()) && host.isFile(t));
    if (script) return { command: host.execPath, prefixArgs: [script], resolvedFrom: shim };
    const native = targets.find(
      (t) => NATIVE.has(p.extname(t).toLowerCase()) && p.basename(t).toLowerCase() !== 'node.exe' && host.isFile(t),
    );
    if (native) return { command: native, prefixArgs: [], resolvedFrom: shim };
  }
  return null;
}

export function resolveCliCommand(bin: string, host: ResolveHost = defaultResolveHost()): CliCommand {
  const windows = host.platform === 'win32';
  const p = windows ? path.win32 : path.posix;
  const name = bin.trim();
  if (!name) throw new CliNotFoundError('AI_CLI_BIN is empty.');
  const hasDir = name.includes('/') || (windows && name.includes('\\'));
  const bases = !hasDir
    ? host.pathEnv
        .split(windows ? ';' : ':')
        .filter(Boolean)
        .map((dir) => p.join(dir, name))
    : p.isAbsolute(name)
      ? [name]
      : [p.resolve(host.cwd, name), p.resolve(host.rootDir, name)];

  if (SCRIPT.has(p.extname(name).toLowerCase())) {
    const script = bases.find(host.isFile);
    if (!script) throw new CliNotFoundError(`The script "${name}" does not exist.`);
    return { command: host.execPath, prefixArgs: [script], resolvedFrom: script };
  }
  if (!windows) {
    // A bare name is searched on PATH by spawn itself, which also honours shebangs.
    if (!hasDir) return { command: name, prefixArgs: [], resolvedFrom: name };
    const file = bases.find(host.isFile);
    if (!file) throw new CliNotFoundError(`"${name}" does not exist.`);
    return { command: file, prefixArgs: [], resolvedFrom: file };
  }

  const exts = host.pathExt
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const candidates = bases.flatMap((b) => (p.extname(b) ? [b] : [...exts.map((e) => b + e), b]));
  const found = candidates.find(host.isFile);
  if (!found) throw new CliNotFoundError(`No "${name}" was found ${hasDir ? 'at that path' : 'on PATH'}.`);

  const ext = p.extname(found).toLowerCase();
  if (NATIVE.has(ext)) return { command: found, prefixArgs: [], resolvedFrom: found };
  if (SCRIPT.has(ext)) return { command: host.execPath, prefixArgs: [found], resolvedFrom: found };
  const target = shimTarget(found, host, p);
  if (target) return target;
  throw new CliNotFoundError(
    `Found "${found}" but could not tell what it runs, and it will not be run through a shell. ` +
      'Set AI_CLI_BIN to the real program (for an npm install: ' +
      `${p.join(p.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')}).`,
  );
}
