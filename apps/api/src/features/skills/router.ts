import { Router } from 'express';
import { AddSkillBodySchema, SkillsQuerySchema, type AddSkillResponse, type SkillsResponse } from '@tailorit/shared';
import { inferSkillCategory, libraryCategory, skillIndexKey } from '@tailorit/render';
import { requireUser, userOf } from '../../core/auth/guards';
import { nowIso, type AppDeps } from '../../core/context';
import { parseInput } from '../../core/http/validate';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { userSkillRows } from '../resumes/engine';

// The skill library (static/skills/skills.json, shared, never written) with each user's own skills laid over it
// (`user_skills`). Owned by work package R1. A skill a person adds is theirs alone: it never reaches anyone else's
// library, and Grouped files it under the heading inferred for it.

/** Mounted at /api/skills. */
export function createSkillsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    const { type } = parseInput(SkillsQuerySchema, req.query, 'query');
    const library = getSkillLibrary();
    // Every spelling, aliases included: "GCP" and "HTML5" are what people write, so the picker still offers them.
    const names = type === 'hard' ? library.spellings.map((record) => record.skill) : [...library.soft];
    const seen = new Set(names.map((name) => skillIndexKey(name)));
    for (const row of userSkillRows(deps, userOf(req).id, type)) {
      const key = skillIndexKey(row.skill);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(row.skill);
    }
    const body: SkillsResponse = { type, skills: names };
    res.json(body);
  });

  router.post('/', (req, res) => {
    const { type, skill, category } = parseInput(AddSkillBodySchema, req.body);
    const userId = userOf(req).id;
    const name = skill.replace(/\s+/g, ' ').trim();
    const key = skillIndexKey(name);
    const library = getSkillLibrary();

    if (type === 'hard') {
      const known = library.byKey.get(name.toLowerCase()) ?? library.spellings.find((record) => skillIndexKey(record.skill) === key);
      if (known) {
        const body: AddSkillResponse = { added: false, skill: known.skill, type, category: known.category || null };
        res.json(body);
        return;
      }
    } else {
      const known = library.soft.find((entry) => skillIndexKey(entry) === key);
      if (known) {
        const body: AddSkillResponse = { added: false, skill: known, type, category: null };
        res.json(body);
        return;
      }
    }

    const own = deps.db
      .prepare('SELECT skill, category FROM user_skills WHERE user_id = ? AND type = ? AND skill_key = ?')
      .get(userId, type, key) as { skill: string; category: string } | undefined;
    if (own) {
      const body: AddSkillResponse = { added: false, skill: own.skill, type, category: type === 'hard' ? own.category || null : null };
      res.json(body);
      return;
    }

    const heading = type === 'hard' ? (libraryCategory(category) ?? inferSkillCategory(name)) : '';
    deps.db
      .prepare('INSERT INTO user_skills(user_id, skill_key, skill, type, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, key, name, type, heading, nowIso(deps));
    const body: AddSkillResponse = { added: true, skill: name, type, category: type === 'hard' ? heading : null };
    res.status(201).json(body);
  });

  return router;
}
