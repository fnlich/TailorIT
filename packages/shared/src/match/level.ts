import { EXPERIENCE_LEVELS, EXPERIENCE_LEVEL_SHORT, type ExperienceLevel } from '../jobs/enums';
import type { LevelMatch } from './schemas';

/** Simplify's tooltip line for a posting whose level is one the user is looking for. */
export const LEVEL_MATCH_PREFIX = 'Your experience level matches one of the following:';
export const LEVEL_JOB_ASKS_PREFIX = 'This job asks for:';
export const LEVEL_LOOKING_FOR_PREFIX = "You're looking for:";
export const LEVEL_ADJACENT_NOTE = 'You can still be a good fit — employers often consider adjacent experience levels.';

function labelsOf(levels: readonly ExperienceLevel[]): string[] {
  const set = new Set(levels);
  return EXPERIENCE_LEVELS.filter((level) => set.has(level)).map((level) => EXPERIENCE_LEVEL_SHORT[level]);
}

/**
 * The facts grid's experience-level check: the posting's levels against the levels the user prefers (Settings). Any
 * overlap is a match; none is a mismatch with Simplify's reassurance; no preferences, or a posting with no level,
 * shows nothing. Labels are the short forms ("Entry", "Mid", ...), in level order.
 */
export function levelMatch(
  jobLevels: readonly ExperienceLevel[],
  preferredLevels: readonly ExperienceLevel[],
): LevelMatch {
  const jobLabels = labelsOf(jobLevels);
  const preferredLabels = labelsOf(preferredLevels);
  if (jobLabels.length === 0 || preferredLabels.length === 0) {
    return { state: 'none', jobLabels, preferredLabels, matchingLabels: [], lines: [] };
  }
  const preferred = new Set(preferredLevels);
  const matchingLabels = labelsOf(jobLevels.filter((level) => preferred.has(level)));
  if (matchingLabels.length > 0) {
    return {
      state: 'match',
      jobLabels,
      preferredLabels,
      matchingLabels,
      lines: [`${LEVEL_MATCH_PREFIX} ${jobLabels.join(', ')}`],
    };
  }
  return {
    state: 'mismatch',
    jobLabels,
    preferredLabels,
    matchingLabels,
    lines: [
      `${LEVEL_JOB_ASKS_PREFIX} ${jobLabels.join(', ')}`,
      `${LEVEL_LOOKING_FOR_PREFIX} ${preferredLabels.join(', ')}`,
      LEVEL_ADJACENT_NOTE,
    ],
  };
}
