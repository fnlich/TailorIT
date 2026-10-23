import { pruneExpiredLoginCodes } from '../../core/auth/codes';
import { pruneExpiredSessions } from '../../core/auth/session';
import { configuredAdminEmails, promoteConfiguredAdmins } from '../../core/auth/users';
import type { AppDeps } from '../../core/context';
import type { Feature } from '../../core/feature';
import { createAuthRouter } from './router';
import { createAuthService, signInOptions } from './service';

const PRUNE_EVERY_MS = 60 * 60_000;

/**
 * Startup: drop expired sessions and codes (then hourly), promote ADMIN_EMAILS accounts that already exist, and say
 * in the log what would otherwise fail quietly (nobody can sign in, nobody is an administrator).
 */
export function startAuth(deps: AppDeps): () => void {
  const prune = () => {
    try {
      const sessions = pruneExpiredSessions(deps);
      const codes = pruneExpiredLoginCodes(deps);
      if (sessions || codes) deps.log.debug(`[auth] pruned ${sessions} expired session(s), ${codes} expired code(s)`);
    } catch (error) {
      deps.log.warn('[auth] could not prune expired sessions', error);
    }
  };
  prune();

  const promoted = promoteConfiguredAdmins(deps);
  if (promoted) deps.log.info(`[auth] ${promoted} account(s) listed in ADMIN_EMAILS were made administrators.`);
  if (configuredAdminEmails(deps).length === 0) {
    deps.log.warn('[auth] No administrator is configured. Add your address to ADMIN_EMAILS in .env and restart.');
  }

  const options = signInOptions(deps);
  if (!options.google.available && !options.email.available) {
    deps.log.warn(
      '[auth] Nobody can sign in: set GOOGLE_CLIENT_ID, or SMTP_HOST, SMTP_USER and SMTP_PASS, in .env and restart.',
    );
  }
  if (options.email.devCodesInConsole) {
    deps.log.info('[auth] SMTP is not configured: sign-in codes are printed in this console instead of emailed.');
  }
  if (deps.config.auth.devFixedCode) {
    deps.log.warn('[auth] AUTH_DEV_FIXED_CODE is set: that code signs in ANY address. Use it for tests only.');
  }

  const timer = setInterval(prune, PRUNE_EVERY_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    deps.services.auth?.mailer?.close();
  };
}

// Passwordless sign-in (Google + email code) and sessions. Owned by work package F3.
export const authFeature: Feature = {
  name: 'auth',
  services: (deps) => {
    deps.services.auth = createAuthService(deps);
  },
  routes: [{ path: '/api/auth', router: createAuthRouter }],
  start: startAuth,
};
