import type { Feature } from '../../core/feature';
import { createAdminUsersRouter } from './router';

// Administrator: list accounts, change role, disable. Owned by work package F3.
export const adminUsersFeature: Feature = {
  name: 'admin-users',
  routes: [
    { path: '/api/admin/users', router: createAdminUsersRouter },
  ],
};
