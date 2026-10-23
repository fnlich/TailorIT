// Reduces the CLI's stream-json events into one turn's outcome. Unknown event types are ignored by construction: new
// CLI versions add events (active_goal, autocompact_state, ...) and a parser that rejects them breaks on upgrade.

export interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  isUsingOverage?: boolean;
}

export interface TurnState {
  /** Text from `text_delta` events; the fallback when no successful `result` arrives. */
  deltaText: string;
  /** Text blocks of the `assistant` message; the fallback when no deltas arrived either. */
  assistantText: string;
  /** `result.result`: the authoritative answer, when the turn did not fail. */
  resultText: string | null;
  sawResult: boolean;
  isError: boolean;
  apiErrorStatus: number | null;
  stopReason: string | null;
  /** Error marks from `assistant.error` and `result.errors`. */
  errors: string[];
  /** The model that answered (from `assistant`), else the one `system/init` names. */
  model: string | null;
  /** From `system/init`. Anything but "none" means an API key is paying for this call. */
  apiKeySource: string | null;
  rateLimit: RateLimitInfo | null;
  retries: number;
  events: number;
}

export function createTurnState(): TurnState {
  return {
    deltaText: '',
    assistantText: '',
    resultText: null,
    sawResult: false,
    isError: false,
    apiErrorStatus: null,
    stopReason: null,
    errors: [],
    model: null,
    apiKeySource: null,
    rateLimit: null,
    retries: 0,
    events: 0,
  };
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Applies one NDJSON line. Lines that are not JSON objects (banners, warnings) are skipped, never fatal. */
export function reduceEvent(state: TurnState, line: string): void {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!isObject(event)) return;
  state.events += 1;

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        state.model = text(event.model) ?? state.model;
        if (typeof event.apiKeySource === 'string') state.apiKeySource = event.apiKeySource;
      } else if (event.subtype === 'api_retry') {
        // A retry restarts the message: what streamed before it is not the start of the answer any more.
        state.deltaText = '';
        state.retries += 1;
      }
      return;
    case 'stream_event': {
      const delta = isObject(event.event) && isObject(event.event.delta) ? event.event.delta : null;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') state.deltaText += delta.text;
      return;
    }
    case 'assistant': {
      const message = isObject(event.message) ? event.message : null;
      const model = text(message?.model);
      if (model && model !== '<synthetic>') state.model = model;
      state.stopReason = text(message?.stop_reason) ?? state.stopReason;
      if (Array.isArray(message?.content)) {
        const parts = message.content.filter(isObject).filter((block) => block.type === 'text');
        const joined = parts.map((block) => (typeof block.text === 'string' ? block.text : '')).join('');
        if (joined) state.assistantText = joined;
      }
      const mark = text(event.error);
      if (mark) state.errors.push(mark);
      return;
    }
    case 'rate_limit_event':
      if (isObject(event.rate_limit_info)) state.rateLimit = event.rate_limit_info as RateLimitInfo;
      return;
    case 'result':
      state.sawResult = true;
      state.isError = event.is_error === true;
      state.apiErrorStatus = num(event.api_error_status);
      state.stopReason = state.stopReason ?? text(event.stop_reason);
      state.resultText = typeof event.result === 'string' ? event.result : null;
      if (Array.isArray(event.errors)) {
        for (const entry of event.errors) if (text(entry)) state.errors.push(entry as string);
      }
      return;
    default:
      return;
  }
}

/**
 * The answer: `result.result` when the turn did not fail (on a failure it holds the CLI's explanation, which must not
 * reach a JSON parser), else the streamed deltas, else the assistant message's text.
 */
export function turnText(state: TurnState): string {
  if (state.sawResult && !state.isError && state.resultText?.trim()) return state.resultText;
  return state.deltaText || state.assistantText;
}

/** True when `system/init` named any credential source other than "none" (i.e. not the subscription). */
export function billedToKey(state: TurnState): boolean {
  return state.apiKeySource !== null && state.apiKeySource !== 'none';
}
