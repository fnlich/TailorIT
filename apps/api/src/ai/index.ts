import type { Response } from 'express';
import type { AiTaskAccepted } from '@tailorit/shared';
import type { AppDeps } from '../core/context';
import { AppError } from '../core/http/errors';
import type { AiService } from './queue';

// Public surface of the AI layer for feature packages. Prompt modules live with their feature; handlers are
// registered in the feature's `services` hook (ai-tasks runs before every feature that uses AI).

export {
  AI_ERROR_KINDS,
  AI_ERROR_MESSAGES,
  AI_MESSAGES,
  AiError,
  aiErrorCode,
  type AiErrorKind,
} from './errors';
export { extractJSON, JSON_BEGIN, JSON_END, JsonExtractError, repairJson } from './json';
export {
  buildSystemText,
  jsonInstruction,
  type PromptCallInfo,
  type PromptModule,
  type RunPrompt,
  type RunPromptOptions,
} from './runPrompt';
export {
  createAiService,
  describeHealth,
  MAX_ACTIVE_PER_USER_KIND,
  type AiService,
  type AiTaskContext,
  type AiTaskHandler,
  type AiTestResult,
  type EnqueueOptions,
} from './queue';
export type { AiPriority } from './semaphore';
export type { AiProvider, CompletionRequest, CompletionResult, ProviderHold } from './provider/types';

/** The AI service, or a 503 a person can read when this server was built without it. */
export function requireAi(deps: Pick<AppDeps, 'services'>): AiService {
  const ai = deps.services.ai;
  if (!ai) throw new AppError('ai_unavailable', 'AI is not set up on this server.');
  return ai;
}

/** Answers an AI endpoint: 202 { taskId }. The page then polls GET /api/ai/tasks/:id. */
export function sendAccepted(res: Response, accepted: { taskId: string }): void {
  const body: AiTaskAccepted = { taskId: accepted.taskId };
  res.status(202).json(body);
}
