import type { AiErrorKind } from '../errors';
import type { CliStatus } from './health';

/** One completion: the system text and the user message, answered as text. */
export interface CompletionRequest {
  /** The feature tag (an AI task kind, or "echo" for the admin test): used for holds and logs. */
  tag: string;
  system: string;
  user: string;
  model: string;
  effort: string;
  signal?: AbortSignal;
  /** Shorter than the configured deadline (the admin test). */
  timeoutMs?: number;
  /** Run even while a hold is active (the admin test is how an operator checks a fix). */
  ignoreHolds?: boolean;
}

export interface CompletionResult {
  text: string;
  /** The model that answered, as the CLI reported it; null when it did not say. */
  model: string | null;
  ms: number;
}

/** Calls are turned away until `until` (epoch ms): `scope` is '*' for every feature or one feature tag. */
export interface ProviderHold {
  scope: string;
  until: number;
  kind: AiErrorKind;
  reason: string;
}

/**
 * The AI transport. The Claude CLI is the only one today; an API-key provider could implement the same interface.
 * `complete` throws AiError (see errors.ts) for every failure.
 */
export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** CLI version and sign-in, cached for 60 s unless `force`. */
  status(force?: boolean): Promise<CliStatus>;
  /** The longest active hold that would turn away a call for `tag`, or null. */
  holdFor(tag: string): ProviderHold | null;
  activeHolds(): ProviderHold[];
  clearHolds(): void;
}
