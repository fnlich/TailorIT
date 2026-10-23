import { Router } from 'express';
import { PreferencesSchema, SetDefaultResumeBodySchema, type Preferences } from '@tailorit/shared';
import { requireUser, userOf } from '../../core/auth/guards';
import { getAccount, MAX_NAME_LENGTH } from '../../core/auth/users';
import { nowIso, type AppDeps } from '../../core/context';
import { notFound, validationFailed } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { getPreferences, normalizePreferences, savePreferences } from './preferences';

// The signed-in account: name, preferences, default resume. Owned by work package F3 (see docs/ARCHITECTURE.md).

const MAX_LIST_ENTRIES = 100;
const MAX_LIST_ENTRY_LENGTH = 200;
const MAX_TEXT_LENGTH = 500;

/** Bounds the contract leaves open, so one account cannot store an arbitrarily large row. */
function checkSizes(preferences: Preferences): void {
  const lists = {
    experienceLevels: preferences.experienceLevels,
    jobTypes: preferences.jobTypes,
    workArrangements: preferences.workArrangements,
    categories: preferences.categories,
    locations: preferences.locations,
  };
  for (const [field, items] of Object.entries(lists)) {
    if (items.length > MAX_LIST_ENTRIES || items.some((item) => item.length > MAX_LIST_ENTRY_LENGTH)) {
      const message = `Choose at most ${MAX_LIST_ENTRIES}, each up to ${MAX_LIST_ENTRY_LENGTH} characters.`;
      throw validationFailed(message, { [field]: message });
    }
  }
  const texts = {
    phone: preferences.phone,
    linkedinUrl: preferences.linkedinUrl,
    location: preferences.location,
    portfolioUrl: preferences.portfolioUrl,
  };
  for (const [field, text] of Object.entries(texts)) {
    if (text.length > MAX_TEXT_LENGTH) {
      const message = `Keep this under ${MAX_TEXT_LENGTH} characters.`;
      throw validationFailed(message, { [field]: message });
    }
  }
}

/** Mounted at /api/me. */
export function createMeRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  // The one thing a user may change about their own account (free_tailor's rule and sentences).
  router.patch('/', (req, res) => {
    const user = userOf(req);
    const raw = (req.body as Record<string, unknown> | undefined)?.name;
    if (typeof raw !== 'string') throw validationFailed('There is nothing to change.');
    const name = raw.replace(/\p{Cc}+/gu, ' ').trim();
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      const message = `A display name is between 1 and ${MAX_NAME_LENGTH} characters.`;
      throw validationFailed(message, { name: message });
    }
    deps.db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(deps), user.id);
    res.json(getAccount(deps, user.id));
  });

  router.get('/preferences', (req, res) => {
    res.json(getPreferences(deps, userOf(req).id));
  });

  router.put('/preferences', (req, res) => {
    const preferences = normalizePreferences(parseInput(PreferencesSchema, req.body));
    checkSizes(preferences);
    res.json(savePreferences(deps, userOf(req).id, preferences));
  });

  // Only one of the caller's own resumes can be the default; anyone else's is "not found", never "forbidden".
  router.put('/default-resume', (req, res) => {
    const user = userOf(req);
    const { resumeId } = parseInput(SetDefaultResumeBodySchema, req.body);
    if (resumeId !== null) {
      const own = deps.db.prepare('SELECT 1 FROM resumes WHERE id = ? AND user_id = ?').get(resumeId, user.id);
      if (!own) throw notFound('That resume');
    }
    deps.db
      .prepare('UPDATE users SET default_resume_id = ?, updated_at = ? WHERE id = ?')
      .run(resumeId, nowIso(deps), user.id);
    res.json(getAccount(deps, user.id));
  });

  return router;
}
