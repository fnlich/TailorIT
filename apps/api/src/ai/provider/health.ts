import { execFile, type ExecFileException } from 'node:child_process';
import type { CliCommand } from './resolve';
import { lastLines } from './stream';

/** What `claude --version` and `claude auth status` say about the CLI. */
export interface CliStatus {
  found: boolean;
  version: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  subscriptionType: string | null;
  apiKeySource: string | null;
  /** Why the CLI cannot be used, as a sentence for an administrator; null when nothing is wrong. */
  problem: string | null;
  checkedAt: string;
}

/**
 * `authMethod` values that are the subscription when no API key is named beside them: `claude.ai` is what
 * `claude auth login` saves, `oauth_token` a token handed to the CLI. `api_key`, `api_key_helper` and `third_party`
 * bill per request.
 */
export const SUBSCRIPTION_AUTH_METHODS: readonly string[] = ['claude.ai', 'oauth_token'];

export function isSubscriptionSignIn(status: Pick<CliStatus, 'loggedIn' | 'authMethod' | 'apiKeySource'>): boolean {
  if (!status.loggedIn || !status.authMethod || !SUBSCRIPTION_AUTH_METHODS.includes(status.authMethod)) return false;
  return !status.apiKeySource || status.apiKeySource === 'none';
}

interface Run {
  stdout: string;
  stderr: string;
  error: ExecFileException | null;
}

function run(cli: CliCommand, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      cli.command,
      [...cli.prefixArgs, ...args],
      { env, cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error }),
    );
  });
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Runs both commands (each with its own timeout). Never throws. */
export async function probeCli(options: {
  cli: CliCommand;
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  checkedAt: string;
}): Promise<CliStatus> {
  const { cli, env, cwd, timeoutMs, checkedAt } = options;
  const base: CliStatus = {
    found: true,
    version: null,
    loggedIn: false,
    authMethod: null,
    subscriptionType: null,
    apiKeySource: null,
    problem: null,
    checkedAt,
  };
  const version = await run(cli, ['--version'], env, cwd, timeoutMs);
  if (version.error && !version.stdout.trim()) {
    if (version.error.code === 'ENOENT') {
      return { ...base, found: false, problem: `The Claude CLI could not be started (${cli.command} was not found).` };
    }
    const why = version.error.killed ? `no answer within ${Math.round(timeoutMs / 1000)} s` : lastLines(version.stderr);
    return { ...base, problem: `"claude --version" failed: ${why || version.error.message}.` };
  }
  const result: CliStatus = { ...base, version: version.stdout.trim().split(/\r?\n/)[0] || null };

  // Prints JSON whether or not it is signed in (and exits 1 when it is not).
  const status = await run(cli, ['auth', 'status'], env, cwd, timeoutMs);
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(status.stdout);
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
  } catch {
    const why = status.error?.killed ? `no answer within ${Math.round(timeoutMs / 1000)} s` : lastLines(status.stderr);
    return { ...result, problem: `"claude auth status" did not answer with JSON${why ? `: ${why}` : ''}.` };
  }
  return {
    ...result,
    loggedIn: parsed.loggedIn === true,
    authMethod: str(parsed.authMethod),
    subscriptionType: str(parsed.subscriptionType),
    apiKeySource: str(parsed.apiKeySource),
  };
}
