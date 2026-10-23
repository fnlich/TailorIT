import { createAiService } from '../../ai/index';
import type { Feature } from '../../core/feature';
import { createAiTasksRouter } from './router';

// AI task queue over the local Claude CLI; task polling. Owned by work package F4.
export const aiTasksFeature: Feature = {
  name: 'ai-tasks',
  // Listed before every feature that queues AI work, so they can register their handlers on deps.services.ai.
  services: (deps) => {
    deps.services.ai = createAiService(deps);
  },
  routes: [{ path: '/api/ai/tasks', router: createAiTasksRouter }],
  start: (deps) => deps.services.ai?.start(),
};
