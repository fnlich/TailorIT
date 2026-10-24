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

/** The seat's usage, as the last call that reported it saw it (the CLI's rate_limit_event). */
export interface RateLimitReading {
  /** As the CLI said it: "allowed", "allowed_warning" (the window is nearly used up), "rejected"...; '' if unsaid. */
  status: string;
  /** When the usage window resets (epoch ms), when the CLI said. */
  resetsAtMs: number | null;
  /** The seat was running on paid overage, which TailorIT never accepts. */
  usingOverage: boolean;
  /** When the provider read it (epoch ms, on its clock). */
  seenAtMs: number;
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
  /**
   * The last usage reading a call reported, or null before any; background work waits on a warning (ai/background.ts).
   * Optional: a provider that gets no usage readings leaves it out.
   */
  lastRateLimit?(): RateLimitReading | null;
}
