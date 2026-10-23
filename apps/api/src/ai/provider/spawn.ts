import { spawn, type ChildProcess } from 'node:child_process';
import { NdjsonSplitter, TailBuffer } from './stream';

// The process seam: the only module that spawns the CLI for a completion. Everything above it reads CliRunOutcome.

export interface CliRunSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The prompt. Written to stdin (never argv), then stdin is closed so the CLI does not wait for more. */
  stdin: string;
  /** Wall-clock budget for the whole turn. */
  timeoutMs: number;
  /** How long the child may produce no stdout at all. At a spent usage window the CLI blocks silently. */
  firstEventMs: number;
  signal?: AbortSignal;
  onLine(line: string): void;
  maxOutputBytes?: number;
}

export interface CliRunOutcome {
  exitCode: number | null;
  spawnError: NodeJS.ErrnoException | null;
  timedOut: boolean;
  stalled: boolean;
  aborted: boolean;
  /** stdout grew past maxOutputBytes. */
  overflow: boolean;
  /** The last 64 KB of stderr. */
  stderr: string;
  ms: number;
}

const KILL_GRACE_MS = 5_000;
const DEFAULT_MAX_OUTPUT = 20 * 1024 * 1024;

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/** SIGTERM, then after 5 s a hard kill: `taskkill /T /F` on Windows (the whole tree), SIGKILL elsewhere. */
export function terminate(child: ChildProcess): void {
  if (exited(child)) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  // Not unref'd: it is the guarantee that a child ignoring SIGTERM dies, and it is cleared the moment it exits.
  const hard = setTimeout(() => {
    if (exited(child)) return;
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => {
        /* nothing more to try */
      });
    } else {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, KILL_GRACE_MS);
  child.once('exit', () => clearTimeout(hard));
}

export function runCli(spec: CliRunSpec): Promise<CliRunOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const splitter = new NdjsonSplitter();
    const stderr = new TailBuffer();
    const maxOutput = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const flags = { timedOut: false, stalled: false, aborted: false, overflow: false };
    let settled = false;
    let sawOutput = false;
    let bytes = 0;
    let child: ChildProcess | null = null;
    const timers: { deadline?: NodeJS.Timeout; stall?: NodeJS.Timeout } = {};

    const finish = (exitCode: number | null, spawnError: NodeJS.ErrnoException | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timers.deadline);
      clearTimeout(timers.stall);
      spec.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, spawnError, ...flags, stderr: stderr.text(), ms: Date.now() - startedAt });
    };
    const stop = (flag: keyof typeof flags) => {
      if (settled) return;
      flags[flag] = true;
      if (child) terminate(child);
      finish(null);
    };
    function onAbort() {
      stop('aborted');
    }

    if (spec.signal?.aborted) {
      flags.aborted = true;
      finish(null);
      return;
    }
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      // Synchronous failures: an argument with a NUL byte, an invalid cwd type...
      finish(null, error as NodeJS.ErrnoException);
      return;
    }
    spec.signal?.addEventListener('abort', onAbort, { once: true });
    timers.deadline = setTimeout(() => stop('timedOut'), Math.max(1, spec.timeoutMs));
    timers.stall = setTimeout(() => {
      if (!sawOutput) stop('stalled');
    }, Math.max(1, spec.firstEventMs));
    timers.deadline.unref?.();
    timers.stall.unref?.();

    child.on('error', (error: NodeJS.ErrnoException) => finish(null, error));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (!sawOutput) {
        sawOutput = true;
        clearTimeout(timers.stall);
      }
      bytes += chunk.length;
      if (bytes > maxOutput) {
        stop('overflow');
        return;
      }
      for (const line of splitter.push(chunk)) {
        if (line.trim()) spec.onLine(line);
        // onLine may have stopped the turn (an API key in system/init).
        if (settled) return;
      }
    });
    child.stdin?.on('error', () => {
      /* the child may exit before reading its input; the outcome says why */
    });
    child.stdin?.end(spec.stdin, 'utf8');
    child.on('close', (code) => {
      if (settled) return;
      const rest = splitter.flush();
      if (rest) spec.onLine(rest);
      finish(code);
    });
  });
}
