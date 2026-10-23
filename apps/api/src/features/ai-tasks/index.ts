import type { Feature } from '../../core/feature';
import { createAiTasksRouter } from './router';

// AI task queue over the local Claude CLI; task polling. Owned by work package F4.
export const aiTasksFeature: Feature = {
  name: 'ai-tasks',
  routes: [
    { path: '/api/ai/tasks', router: createAiTasksRouter },
  ],
};
