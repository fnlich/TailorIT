import type { Feature } from '../../core/feature';
import { createSkillsRouter } from './router';

// Skill library (skills.json) + per-user skills. Owned by work package R1.
export const skillsFeature: Feature = {
  name: 'skills',
  routes: [
    { path: '/api/skills', router: createSkillsRouter },
  ],
};
