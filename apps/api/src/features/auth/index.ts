import type { Feature } from '../../core/feature';
import { createAuthRouter } from './router';

// Passwordless sign-in (Google + email code) and sessions. Owned by work package F3.
export const authFeature: Feature = {
  name: 'auth',
  routes: [
    { path: '/api/auth', router: createAuthRouter },
  ],
};
