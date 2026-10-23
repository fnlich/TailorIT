// The command line for one `claude -p` turn. Pure, so the flag set is asserted in tests without spawning anything.

/**
 * Flags this provider must never pass. `--bare` makes Anthropic auth "strictly ANTHROPIC_API_KEY or apiKeyHelper
 * (OAuth and keychain are never read)": the opposite of running on the subscription seat. `--safe-mode` is the flag
 * that turns off CLAUDE.md, skills, plugins, hooks and MCP while leaving the sign-in alone.
 */
export const FORBIDDEN_FLAGS = ['--bare'] as const;

export const CLI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CliEffort = (typeof CLI_EFFORTS)[number];

/** Replaces Claude Code's coding-agent system prompt when the real instructions have to travel on stdin. */
export const BASE_SYSTEM_PROMPT =
  'Answer exactly what the message asks for and nothing else: no preamble and no commentary. ' +
  'You have no tools and no files; write the whole answer in your reply.';

/** Windows limits the WHOLE command line to 32,767 UTF-16 units; this leaves room for the executable's path. */
export const WINDOWS_COMMAND_LINE_BUDGET = 30_000;
/** POSIX limits one argument to 128 KiB (MAX_ARG_STRLEN). */
export const POSIX_SYSTEM_PROMPT_BYTES = 100_000;

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/** A model name the CLI can be handed safely: an alias or a full id, never something that reads as a flag. */
export function isCliModelName(name: string): boolean {
  return MODEL_NAME.test(name);
}

export function normalizeEffort(value: string): CliEffort | null {
  const effort = value.trim().toLowerCase();
  return (CLI_EFFORTS as readonly string[]).includes(effort) ? (effort as CliEffort) : null;
}

/** What Node's Windows quoting makes of argv: each entry quoted (+2) and separated (+1), `"` and `\` escaped. */
export function windowsCommandLineCost(args: readonly string[]): number {
  return args.reduce((total, arg) => total + arg.length + (arg.match(/["\\]/g)?.length ?? 0) + 3, 0);
}

export interface ClaudeArgvOptions {
  model: string;
  effort: CliEffort;
  systemPrompt: string;
  fallbackModel?: string | null;
  /** Injected by tests so the Windows budget is covered on any host. */
  platform?: NodeJS.Platform;
}

export interface ClaudeInvocation {
  argv: string[];
  /** System text that did not fit on the command line; it goes at the head of stdin. Empty normally. */
  stdinPrefix: string;
}

export function buildClaudeArgv(options: ClaudeArgvOptions): ClaudeInvocation {
  if (!isCliModelName(options.model)) throw new Error(`"${options.model}" is not a Claude model name.`);
  const platform = options.platform ?? process.platform;
  // A value that starts with "-" could be read as another option by the CLI's argument parser.
  let system = options.systemPrompt.trim() || BASE_SYSTEM_PROMPT;
  if (system.startsWith('-')) system = `Instructions:\n${system}`;

  const argv = [
    '-p',
    // stream-json, so a turn that dies still yields the events that arrived, and the first event (system/init, which
    // names the credential) can stop a metered call before the model answers.
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose', // required by stream-json
    '--model',
    options.model,
    '--effort',
    options.effort,
    // No tools at all: the answer is text, and a tool call is a way for the turn to end without one.
    '--tools',
    '',
    // The operator's CLAUDE.md, skills, plugins, hooks and MCP servers have no business steering this call.
    '--safe-mode',
    '--strict-mcp-config',
    '--disable-slash-commands',
    // Nothing may wait for a person who is not there.
    '--permission-prompts',
    'none',
    // One stateless completion; otherwise every call leaves a transcript in the CLI's config directory.
    '--no-session-persistence',
    '--system-prompt',
    system,
  ];
  const systemIndex = argv.length - 1;
  const fallback = options.fallbackModel?.trim();
  // The CLI refuses a fallback equal to the main model.
  if (fallback && fallback !== options.model && isCliModelName(fallback)) argv.push('--fallback-model', fallback);

  const overflows =
    platform === 'win32'
      ? windowsCommandLineCost(argv) > WINDOWS_COMMAND_LINE_BUDGET
      : Buffer.byteLength(system, 'utf8') > POSIX_SYSTEM_PROMPT_BYTES;
  if (!overflows) return { argv, stdinPrefix: '' };

  // Same text, same order, simply not carried by the command line.
  argv[systemIndex] = BASE_SYSTEM_PROMPT;
  return { argv, stdinPrefix: system };
}
