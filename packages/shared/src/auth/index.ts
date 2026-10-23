import { z } from 'zod';
import { IsoDateTime } from '../core/list';
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_ARRANGEMENTS } from '../jobs/enums';

// Passwordless sign-in (free_tailor's flow): Google Identity Services button, or a six-digit code sent by email.
// Sessions are an httpOnly cookie only; the API never returns a bearer token.

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const AccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(ROLES),
  defaultResumeId: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type Account = z.infer<typeof AccountSchema>;

export const AuthOptionsSchema = z.object({
  google: z.object({ available: z.boolean(), clientId: z.string().nullable() }),
  email: z.object({
    available: z.boolean(),
    /** Development only: codes are printed by the API instead of emailed. */
    devCodesInConsole: z.boolean(),
  }),
  /** "Trouble signing in? Contact admin" opens a mailto to this address when set. */
  contactEmail: z.string().nullable(),
});
export type AuthOptions = z.infer<typeof AuthOptionsSchema>;

export const GoogleSignInBodySchema = z.object({ credential: z.string() });
export const EmailCodeRequestBodySchema = z.object({ email: z.string() });
export const EmailCodeVerifyBodySchema = z.object({ email: z.string(), code: z.string() });

export const EmailCodeRequestResponseSchema = z.object({
  sent: z.literal(true),
  email: z.string(),
  expiresInMinutes: z.number().int(),
  /** e.g. "A six-digit code is on its way to you@example.com. It expires in 10 minutes." */
  message: z.string(),
});
export type EmailCodeRequestResponse = z.infer<typeof EmailCodeRequestResponseSchema>;

export const SignInResponseSchema = z.object({ account: AccountSchema, created: z.boolean() });
export type SignInResponse = z.infer<typeof SignInResponseSchema>;

/** GET /api/auth/me always answers 200; a signed-out caller gets `{ account: null }`. */
export const MeResponseSchema = z.object({ account: AccountSchema.nullable() });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeBodySchema = z.object({ name: z.string() });

export const PreferencesSchema = z.object({
  experienceLevels: z.array(z.enum(EXPERIENCE_LEVELS)),
  jobTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
  workArrangements: z.array(z.enum(WORK_ARRANGEMENTS)),
  categories: z.array(z.string()),
  locations: z.array(z.string()),
  minSalary: z.number().int().nonnegative().nullable(),
  // Contact details used for cover-letter profile variables when the resume lacks them.
  phone: z.string(),
  linkedinUrl: z.string(),
  location: z.string(),
  portfolioUrl: z.string(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const EMPTY_PREFERENCES: Preferences = {
  experienceLevels: [],
  jobTypes: [],
  workArrangements: [],
  categories: [],
  locations: [],
  minSalary: null,
  phone: '',
  linkedinUrl: '',
  location: '',
  portfolioUrl: '',
};

export const SetDefaultResumeBodySchema = z.object({ resumeId: z.string().nullable() });

/** Display initials for the header avatar: "David Jack" -> "DJ"; falls back to the email's first letter. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? '?').toUpperCase();
}
