import type { Feature } from '../../core/feature';
import { createAdminAiRouter } from './router';

// Administrator: Claude CLI health and a test prompt. Owned by work package F4.
export const adminAiFeature: Feature = {
  name: 'admin-ai',
  routes: [{ path: '/api/admin/ai', router: createAdminAiRouter }],
};
