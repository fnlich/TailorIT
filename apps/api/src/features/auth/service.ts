import type { Request, Response } from 'express';
import type { AuthOptions, EmailCodeRequestResponse, SignInResponse } from '@tailorit/shared';
import {
  CODE_RESEND_COOLDOWN_MS,
  codeSentAt,
  consumeLoginCode,
  deleteLoginCode,
  generateLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  storeLoginCode,
  type LoginCodeFailure,
} from '../../core/auth/codes';
import { createGoogleTokenVerifier, type GoogleTokenVerifier } from '../../core/auth/google';
import { createSession, destroySession, setSessionCookie } from '../../core/auth/session';
import {
  findOrCreateUser,
  getAccount,
  isEmailAddress,
  markSignedIn,
  normalizeEmail,
  promoteIfConfiguredAdmin,
  type ProvenIdentity,
} from '../../core/auth/users';
import type { AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { AppError } from '../../core/http/errors';
import { createSmtpMailer, type Mailer } from '../../core/mail/mailer';
import { signInCodeEmail } from '../../core/mail/sign-in-code';

// Passwordless sign-in (free_tailor's rules). Both paths prove control of an address and then do exactly the same
// thing with it (completeSignIn), so they cannot drift into two notions of a signed-in user.

export interface AuthService {
  /** Delivers sign-in codes; null without SMTP settings. Tests replace it with a recording fake. */
  mailer: Mailer | null;
  /** Checks a Google ID token for this app's client id. Tests replace it so they never call Google. */
  verifyGoogleToken: GoogleTokenVerifier;
  /** Addresses whose code email is being sent right now: one send at a time per address. */
  readonly sending: Set<string>;
}

declare module '../../core/context' {
  interface AppServices {
    /** Sign-in mail and Google verification (features/auth). */
    auth?: AuthService;
  }
}

export function createAuthService(deps: AppDeps): AuthService {
  const smtp = deps.config.auth.smtp;
  return {
    mailer: smtp ? createSmtpMailer(smtp) : null,
    verifyGoogleToken: createGoogleTokenVerifier(),
    sending: new Set(),
  };
}

function authService(deps: AppDeps): AuthService {
  const service = deps.services.auth;
  if (!service) throw new AppError('internal', 'Sign-in is not set up on this server.');
  return service;
}

const SIGN_IN_UNAVAILABLE = "Sign-in isn't available right now. Please contact your administrator.";
const MAIL_FAILED =
  'We could not send the sign-in email right now. Please try again in a few minutes, or contact your administrator.';
const NOT_AN_EMAIL = 'That does not look like an email address.';
const NOT_SIX_DIGITS = 'A sign-in code is six digits.';
const ACCOUNT_DISABLED = 'That account has been disabled. Ask an administrator of this installation to re-enable it.';

const CODE_FAILURES: Record<LoginCodeFailure, string> = {
  no_code: 'That code has already been used, or none was sent to this address. Ask for a new one.',
  expired: 'That code has expired. Ask for a new one.',
  too_many_attempts:
    `That code was entered wrongly ${LOGIN_CODE_MAX_ATTEMPTS} times and is no longer valid. Ask for a new one.`,
  wrong_code: 'That code is not right. Check the email and try again.',
};

const GOOGLE_FAILURES = {
  noCredential: 'No Google credential was sent.',
  notVerified: 'That Google sign-in could not be verified. Please try again.',
  noPayload: 'Google returned a sign-in with no account details.',
  noEmail: 'That Google account has no email address.',
  unverifiedEmail: 'That Google account has not verified its email address, so it cannot be used to sign in.',
};

// Refusals about the caller's own address, code or credential are 401 (as in free_tailor) with code
// validation_failed, never not_signed_in: the sign-in page shows the sentence instead of redirecting to itself.
function refused(message: string, field?: string, cause?: unknown): AppError {
  const fields = field ? { [field]: message } : undefined;
  return new AppError('validation_failed', message, { status: 401, fields, cause });
}

function invalid(field: string, message: string): AppError {
  return new AppError('validation_failed', message, { fields: { [field]: message } });
}

/** What the sign-in page can offer. Public by design: the Google client id is in every page that uses it. */
export function signInOptions(deps: AppDeps): AuthOptions {
  const { googleClientId, smtp, devLogCodes, devFixedCode, contactEmail } = deps.config.auth;
  return {
    google: { available: googleClientId !== null, clientId: googleClientId },
    email: {
      available: smtp !== null || devLogCodes || devFixedCode !== null,
      devCodesInConsole: smtp === null && devLogCodes,
    },
    contactEmail,
  };
}

/**
 * Sends a sign-in code. The answer is the same whether or not the address has an account (the account is made on
 * verification anyway), so this cannot be used to ask who is a user here.
 */
export async function requestEmailCode(deps: AppDeps, rawEmail: string): Promise<EmailCodeRequestResponse> {
  const email = normalizeEmail(rawEmail);
  if (!isEmailAddress(email)) throw invalid('email', NOT_AN_EMAIL);
  if (!signInOptions(deps).email.available) throw new AppError('sign_in_unavailable', SIGN_IN_UNAVAILABLE);
  const service = authService(deps);

  const sentAt = codeSentAt(deps, email);
  const waitedMs = sentAt === null ? null : deps.now().getTime() - sentAt;
  if (service.sending.has(email) || (waitedMs !== null && waitedMs < CODE_RESEND_COOLDOWN_MS)) {
    const remainingMs = service.sending.has(email) ? CODE_RESEND_COOLDOWN_MS : CODE_RESEND_COOLDOWN_MS - waitedMs!;
    const seconds = Math.min(CODE_RESEND_COOLDOWN_MS / 1000, Math.max(1, Math.ceil(remainingMs / 1000)));
    throw new AppError(
      'cooldown',
      `A code was just sent to that address. Wait ${seconds} more second${seconds === 1 ? '' : 's'} before asking ` +
        'for another, and check the spam folder in the meantime.',
      { retryAfterSeconds: seconds },
    );
  }

  const code = generateLoginCode();
  const ttlMinutes = Math.round(LOGIN_CODE_TTL_MS / 60_000);
  service.sending.add(email);
  try {
    // Sent BEFORE it is stored: the other order would leave a live code that never arrived, and the person inside the
    // resend cooldown for a code they cannot have.
    if (service.mailer) {
      try {
        await service.mailer.send(signInCodeEmail(email, code, ttlMinutes));
      } catch (error) {
        throw new AppError('sign_in_unavailable', MAIL_FAILED, { status: 502, cause: error });
      }
    } else if (deps.config.auth.devLogCodes) {
      deps.log.info(`[auth] sign-in code for ${email}: ${code}`);
    }
    // With neither (AUTH_DEV_FIXED_CODE only), the code is delivered nowhere; storing it keeps the cooldown honest.
    storeLoginCode(deps, email, code);
  } finally {
    service.sending.delete(email);
  }

  return {
    sent: true,
    email,
    expiresInMinutes: ttlMinutes,
    message: `A six-digit code is on its way to ${email}. It expires in ${ttlMinutes} minutes.`,
  };
}

/** Checks an emailed code; the address it proves is returned for completeSignIn. */
export function verifyEmailCode(deps: AppDeps, rawEmail: string, rawCode: string): ProvenIdentity {
  const email = normalizeEmail(rawEmail);
  if (!isEmailAddress(email)) throw invalid('email', NOT_AN_EMAIL);
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) throw invalid('code', NOT_SIX_DIGITS);

  const fixed = deps.config.auth.devFixedCode;
  if (fixed !== null && code === fixed) {
    // AUTH_DEV_FIXED_CODE (never set in production) signs in any address, requested or not.
    deleteLoginCode(deps, email);
    return { email };
  }

  const check = consumeLoginCode(deps, email, code);
  if (!check.ok) throw refused(CODE_FAILURES[check.reason], 'code');
  return { email };
}

/** Checks a Google ID token (signature, expiry, this audience) and requires a verified address. */
export async function verifyGoogleCredential(deps: AppDeps, credential: string): Promise<ProvenIdentity> {
  const clientId = deps.config.auth.googleClientId;
  if (!clientId) throw new AppError('sign_in_unavailable', SIGN_IN_UNAVAILABLE);
  const idToken = credential.trim();
  if (!idToken) throw refused(GOOGLE_FAILURES.noCredential);

  let payload;
  try {
    // A Google ID token is a couple of kilobytes; anything far larger is not worth sending to the verifier.
    if (idToken.length > 16_384) throw new Error('the credential is far longer than a Google ID token');
    payload = await authService(deps).verifyGoogleToken(idToken, clientId);
  } catch (error) {
    deps.log.warn(`[auth] a Google sign-in could not be verified: ${error instanceof Error ? error.message : error}`);
    throw refused(GOOGLE_FAILURES.notVerified, undefined, error);
  }
  if (!payload) throw refused(GOOGLE_FAILURES.noPayload);
  const email = normalizeEmail(payload.email ?? '');
  if (!isEmailAddress(email)) throw refused(GOOGLE_FAILURES.noEmail);
  // Required, not just read: an unverified address would let someone claim an inbox they do not control, and the
  // address is the whole account here.
  if (payload.email_verified !== true) throw refused(GOOGLE_FAILURES.unverifiedEmail);
  return { email, name: payload.name, avatarUrl: payload.picture, googleSub: payload.sub };
}

/**
 * Everything that happens once an address is proven: find or create the account, refuse a disabled one, promote an
 * ADMIN_EMAILS address, record the sign-in and open a session (replacing the one this browser had).
 */
export function completeSignIn(deps: AppDeps, req: Request, res: Response, identity: ProvenIdentity): SignInResponse {
  const result = transaction(deps.db, () => {
    const { user, created } = findOrCreateUser(deps, identity);
    if (user.disabled_at) throw new AppError('account_disabled', ACCOUNT_DISABLED);
    promoteIfConfiguredAdmin(deps, user);
    markSignedIn(deps, user.id);
    if (req.sessionTokenHash) destroySession(deps, req.sessionTokenHash);
    const session = createSession(deps, user.id, req);
    return { session, account: getAccount(deps, user.id)!, created };
  });
  setSessionCookie(req, res, deps, result.session.token);
  deps.log.debug(`[auth] ${result.account.email} signed in`);
  return { account: result.account, created: result.created };
}
