import type { Feature } from '../../core/feature';
import { createMeRouter } from './router';

// The signed-in account: name, preferences, default resume. Owned by work package F3.
export const meFeature: Feature = {
  name: 'me',
  routes: [
    { path: '/api/me', router: createMeRouter },
  ],
};
