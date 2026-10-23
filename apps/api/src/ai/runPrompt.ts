import type { z } from 'zod';
import type { AiTaskKind } from '@tailorit/shared';
import type { AppConfig } from '../config/env';
import { AiError } from './errors';
import { extractJSON, JSON_BEGIN, JSON_END, JsonExtractError } from './json';
import type { AiProvider } from './provider/types';

/**
 * One AI feature's prompt, owned by the feature package (e.g. `features/resumes/prompts/entryBullets.ts`).
 * `system` is the instruction text, `user` the call's data, `output` the zod schema the reply must satisfy.
 * Bump `version` whenever the wording changes, so stored results can be told apart (e.g. a cache key).
 */
export interface PromptModule<I, O> {
  kind: AiTaskKind;
  version: number;
  system(input: I): string;
  user(input: I): string;
  output: z.ZodType<O>;
}

export interface RunPromptOptions {
  signal?: AbortSignal;
  /** Run under another kind's model/effort settings and scenario tag. Default: `module.kind`. */
  kind?: AiTaskKind;
}

/** Runs a prompt module and returns its validated output. Throws AiError (an AppError) on every failure. */
export type RunPrompt = <I, O>(module: PromptModule<I, O>, input: I, options?: RunPromptOptions) => Promise<O>;

/** What one prompt run cost, for the task row and logs. */
export interface PromptCallInfo {
  tag: string;
  /** The model that answered (or the one requested when the CLI did not say). */
  model: string;
  /** CLI calls made: 1, or 2 when the repair retry ran. */
  calls: number;
  ms: number;
}

/**
 * Appended to every system prompt. The CLI enforces no JSON, so the answer is fenced by sentinels that extractJSON
 * keys on. The `[feature:<kind>]` tag is how the fake CLI (tools/fake-claude) picks its scenario.
 */
export function jsonInstruction(tag: string): string {
  return [
    'Reply with JSON only, exactly in this form and with nothing before or after it:',
    JSON_BEGIN,
    '<one JSON value matching the requested shape>',
    JSON_END,
    'Use double quotes for every key and string. No markdown fences, no comments, no trailing commas, no "..." ' +
      'placeholders. Escape quotes, backslashes and newlines inside strings. When you have no value for a field, use ' +
      'null, an empty string or an empty array; never leave a field out.',
    `[feature:${tag}]`,
  ].join('\n');
}

export function buildSystemText(system: string, tag: string): string {
  return [system.trim(), jsonInstruction(tag)].filter(Boolean).join('\n\n');
}

const MAX_ISSUES = 8;

/** Parses and validates one reply; on failure returns the problems as one sentence for the retry message. */
function check<O>(text: string, schema: z.ZodType<O>): { ok: true; value: O } | { ok: false; problems: string } {
  let value: unknown;
  try {
    value = extractJSON(text);
  } catch (error) {
    if (error instanceof JsonExtractError) return { ok: false, problems: error.message };
    throw error;
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const where = issue.path.length ? issue.path.map(String).join('.') : 'the top-level value';
    return `${where}: ${issue.message}`.slice(0, 200);
  });
  const more = parsed.error.issues.length > MAX_ISSUES ? `; and ${parsed.error.issues.length - MAX_ISSUES} more` : '';
  return { ok: false, problems: `${issues.join('; ')}${more}.` };
}

export interface JsonCall<O> {
  tag: string;
  /** Full system text, including jsonInstruction (see buildSystemText). */
  system: string;
  user: string;
  output: z.ZodType<O>;
  model: string;
  effort: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  ignoreHolds?: boolean;
}

/**
 * One prompt answered as validated JSON. A reply that does not parse or does not match the schema gets ONE stateless
 * retry (a new CLI call; the same system text; the message plus the problems found), then fails as `malformed`.
 * `report` hears what the run cost, whether it succeeded or not.
 */
export async function completeJson<O>(
  provider: AiProvider,
  call: JsonCall<O>,
  report?: (info: PromptCallInfo) => void,
): Promise<{ value: O; info: PromptCallInfo }> {
  const startedAt = Date.now();
  const { output, ...request } = call;
  let user = call.user;
  let answeredBy: string | null = null;
  let calls = 0;
  let problems = '';
  const info = (): PromptCallInfo => ({
    tag: call.tag,
    model: answeredBy ?? call.model,
    calls,
    ms: Date.now() - startedAt,
  });
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      calls = attempt;
      const reply = await provider.complete({ ...request, user });
      answeredBy = reply.model ?? answeredBy;
      const result = check(reply.text, output);
      if (result.ok) return { value: result.value, info: info() };
      problems = result.problems;
      user =
        `${call.user}\n\nYour previous reply did not match the required JSON. Problems: ${problems} ` +
        'Reply again with only the JSON.';
    }
    throw new AiError('malformed', { detail: `Two replies did not match the required JSON. Last: ${problems}` });
  } finally {
    report?.(info());
  }
}

/** Binds runPrompt to a provider and the per-feature model/effort settings (`AI_MODEL_<FEATURE>`, ...). */
export function createRunPrompt(
  provider: AiProvider,
  ai: AppConfig['ai'],
  report?: (info: PromptCallInfo) => void,
): RunPrompt {
  return async (module, input, options = {}) => {
    const kind = options.kind ?? module.kind;
    const { model, effort } = ai.features[kind];
    const call = {
      tag: kind,
      system: buildSystemText(module.system(input), kind),
      user: module.user(input),
      output: module.output,
      model,
      effort,
      signal: options.signal,
    };
    return (await completeJson(provider, call, report)).value;
  };
}
