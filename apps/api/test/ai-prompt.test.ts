import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildConfig } from '../src/config/env';
import { AiError } from '../src/ai/errors';
import { extractJSON, JsonExtractError, repairJson } from '../src/ai/json';
import type { AiProvider, CompletionRequest } from '../src/ai/provider/types';
import {
  buildSystemText,
  completeJson,
  createRunPrompt,
  type PromptCallInfo,
  type PromptModule,
} from '../src/ai/runPrompt';

describe('extractJSON', () => {
  it('parses a reply that is only JSON', () => {
    expect(extractJSON('  {"a": 1}  ')).toEqual({ a: 1 });
    expect(extractJSON('[1, 2]')).toEqual([1, 2]);
  });

  it('takes the text between the sentinels first (the last begin marker, end marker optional)', () => {
    expect(extractJSON('Sure!\n@@BEGIN_JSON@@\n{"a": 1}\n@@END_JSON@@\nAnything else?')).toEqual({ a: 1 });
    const quoted = 'I will wrap it in @@BEGIN_JSON@@ and @@END_JSON@@.\n@@BEGIN_JSON@@{"real": true}@@END_JSON@@';
    expect(extractJSON(quoted)).toEqual({ real: true });
    expect(extractJSON('@@BEGIN_JSON@@\n{"cut": "off"}')).toEqual({ cut: 'off' });
    // Sentinels beat a fence elsewhere in the reply.
    expect(extractJSON('```json\n{"a": 2}\n```\n@@BEGIN_JSON@@{"a": 1}@@END_JSON@@')).toEqual({ a: 1 });
  });

  it('then a ```json fence, then a plain fence', () => {
    expect(extractJSON('Here you go:\n```json\n{"a": 2}\n```\nDone.')).toEqual({ a: 2 });
    expect(extractJSON('Here:\n```\n{"a": 3}\n```')).toEqual({ a: 3 });
  });

  it('then the first balanced object or array that parses, respecting strings', () => {
    const reply = 'Result: {"a": {"b": [1, 2]}, "s": "}{"} hope that helps';
    expect(extractJSON(reply)).toEqual({ a: { b: [1, 2] }, s: '}{' });
    expect(extractJSON('{not json} but this is: {"ok": true}')).toEqual({ ok: true });
    expect(extractJSON('@@BEGIN_JSON@@ note: {"inner": 1} trailing @@END_JSON@@')).toEqual({ inner: 1 });
  });

  it('repairs curly-quote delimiters, comments and trailing commas only after an honest parse failed', () => {
    expect(extractJSON('{“name”: “Ann”, “tags”: [“x”,]}')).toEqual({
      name: 'Ann',
      tags: ['x'],
    });
    expect(extractJSON('{"a": 1, // one\n /* two */ "b": [1, 2,],}')).toEqual({ a: 1, b: [1, 2] });
    expect(extractJSON('@@BEGIN_JSON@@\n{"url": "http://x.example/a,]", "n": 1,}\n@@END_JSON@@')).toEqual({
      url: 'http://x.example/a,]',
      n: 1,
    });
    // Valid JSON with curly quotes inside a string is never rewritten.
    expect(extractJSON('{"quote": "He said “hi”, then left."}')).toEqual({ quote: 'He said “hi”, then left.' });
  });

  it('throws JsonExtractError when there is no JSON at all', () => {
    expect(() => extractJSON('I cannot help with that.')).toThrow(JsonExtractError);
    expect(() => extractJSON('{"a": 1 "b": 2}')).toThrow(/@@BEGIN_JSON@@/);
    expect(() => extractJSON('')).toThrow(JsonExtractError);
  });
});

describe('repairJson', () => {
  it('leaves prose before the JSON alone and commas inside strings intact', () => {
    expect(repairJson('Don’t “panic”: {"a": "x, }",}')).toBe('Don’t “panic”: {"a": "x, }"}');
    expect(repairJson('no json')).toBe('no json');
  });

  it('escapes a straight quote inside a curly-quoted string', () => {
    expect(JSON.parse(repairJson('{“a”: “5" screen”}'))).toEqual({ a: '5" screen' });
  });
});

describe('buildSystemText', () => {
  it('appends the JSON instruction with sentinels and the feature tag', () => {
    const text = buildSystemText('  Write bullets.  ', 'entry_bullets');
    expect(text.startsWith('Write bullets.\n\nReply with JSON only')).toBe(true);
    expect(text).toContain('@@BEGIN_JSON@@');
    expect(text).toContain('@@END_JSON@@');
    expect(text.endsWith('[feature:entry_bullets]')).toBe(true);
  });
});

/** A provider that answers from a list of reply texts and records every request. */
function scriptedProvider(replies: string[]): AiProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    name: 'scripted',
    requests,
    async complete(request) {
      requests.push(request);
      const text = replies[Math.min(requests.length - 1, replies.length - 1)]!;
      return { text, model: `${request.model}-answered`, ms: 1 };
    },
    async status() {
      throw new Error('not used');
    },
    holdFor: () => null,
    activeHolds: () => [],
    clearHolds: () => undefined,
  };
}

const wrap = (value: unknown) => `@@BEGIN_JSON@@\n${JSON.stringify(value)}\n@@END_JSON@@`;

const bulletsModule: PromptModule<{ role: string }, { bullets: string[] }> = {
  kind: 'entry_bullets',
  version: 1,
  system: () => 'Write resume bullets.',
  user: (input) => `Role: ${input.role}`,
  output: z.object({ bullets: z.array(z.string()).min(1) }),
};

describe('runPrompt', () => {
  it('sends the module text with the JSON instruction, on the feature model and effort', async () => {
    const config = buildConfig({ AI_MODEL_BULLETS: 'claude-haiku-5-5', AI_EFFORT_BULLETS: 'medium' });
    const provider = scriptedProvider([wrap({ bullets: ['Shipped it'] })]);
    const calls: PromptCallInfo[] = [];
    const runPrompt = createRunPrompt(provider, config.ai, (info) => calls.push(info));
    await expect(runPrompt(bulletsModule, { role: 'Engineer' })).resolves.toEqual({ bullets: ['Shipped it'] });
    const [request] = provider.requests;
    expect(request).toMatchObject({
      tag: 'entry_bullets',
      model: 'claude-haiku-5-5',
      effort: 'medium',
      user: 'Role: Engineer',
    });
    expect(request!.system).toBe(buildSystemText('Write resume bullets.', 'entry_bullets'));
    expect(calls).toEqual([
      { tag: 'entry_bullets', model: 'claude-haiku-5-5-answered', calls: 1, ms: expect.any(Number) },
    ]);
  });

  it('retries once, statelessly, quoting the problems, when the reply is not valid JSON', async () => {
    const provider = scriptedProvider(['{"bullets": ["a" "b"]}', wrap({ bullets: ['fixed'] })]);
    const runPrompt = createRunPrompt(provider, buildConfig({}).ai);
    await expect(runPrompt(bulletsModule, { role: 'Engineer' })).resolves.toEqual({ bullets: ['fixed'] });
    expect(provider.requests).toHaveLength(2);
    const retry = provider.requests[1]!;
    expect(retry.system).toBe(provider.requests[0]!.system);
    expect(retry.user).toMatch(/^Role: Engineer\n\nYour previous reply did not match the required JSON\. Problems: /);
    expect(retry.user).toContain('no JSON value between @@BEGIN_JSON@@ and @@END_JSON@@');
    expect(retry.user.endsWith('Reply again with only the JSON.')).toBe(true);
  });

  it('quotes the zod issues when the JSON has the wrong shape', async () => {
    const provider = scriptedProvider([wrap({ bullets: [] , extra: 1 }), wrap({ bullets: ['ok'] })]);
    const runPrompt = createRunPrompt(provider, buildConfig({}).ai);
    await runPrompt(bulletsModule, { role: 'Engineer' });
    expect(provider.requests[1]!.user).toMatch(/Problems: bullets: .*1/);
  });

  it('fails as malformed after the second bad reply, and reports both calls', async () => {
    const provider = scriptedProvider([wrap({ bullets: 'nope' })]);
    const calls: PromptCallInfo[] = [];
    const runPrompt = createRunPrompt(provider, buildConfig({}).ai, (info) => calls.push(info));
    const error = await runPrompt(bulletsModule, { role: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ kind: 'malformed', code: 'ai_failed', status: 502 });
    expect((error as AiError).message).toBe('The AI reply could not be understood. Please try again.');
    expect(provider.requests).toHaveLength(2);
    expect(calls[0]!.calls).toBe(2);
  });

  it('runs under another kind when asked, and passes the signal through', async () => {
    const provider = scriptedProvider([wrap({ bullets: ['x'] })]);
    const controller = new AbortController();
    const config = buildConfig({ AI_MODEL_COVER_LETTER: 'claude-opus-5' });
    const runPrompt = createRunPrompt(provider, config.ai);
    await runPrompt(bulletsModule, { role: 'r' }, { kind: 'cover_letter', signal: controller.signal });
    expect(provider.requests[0]).toMatchObject({ tag: 'cover_letter', model: 'claude-opus-5' });
    expect(provider.requests[0]!.signal).toBe(controller.signal);
    expect(provider.requests[0]!.system.endsWith('[feature:cover_letter]')).toBe(true);
  });

  it('completeJson passes provider errors through untouched', async () => {
    const provider = scriptedProvider(['']);
    provider.complete = async () => {
      throw new AiError('auth', { detail: 'signed out' });
    };
    const call = { tag: 'echo', system: 's', user: 'u', output: z.object({}), model: 'm', effort: 'low' };
    await expect(completeJson(provider, call)).rejects.toMatchObject({ kind: 'auth', code: 'ai_unavailable' });
  });
});
