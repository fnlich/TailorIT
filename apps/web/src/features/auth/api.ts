import {
  AuthOptionsSchema,
  EmailCodeRequestResponseSchema,
  SignInResponseSchema,
  type AuthOptions,
  type EmailCodeRequestResponse,
  type SignInResponse,
} from '@tailorit/shared/auth';
import { api } from '@/lib/api';

/** GET /api/auth/options: which sign-in methods this installation offers. */
export function fetchAuthOptions(signal?: AbortSignal): Promise<AuthOptions> {
  return api.get<AuthOptions>('/api/auth/options', { schema: AuthOptionsSchema, signal });
}

/** POST /api/auth/email/request { email } */
export function requestEmailCode(email: string): Promise<EmailCodeRequestResponse> {
  return api.post<EmailCodeRequestResponse>('/api/auth/email/request', { email }, { schema: EmailCodeRequestResponseSchema });
}

/** POST /api/auth/email/verify { email, code } → sets the session cookie. */
export function verifyEmailCode(email: string, code: string): Promise<SignInResponse> {
  return api.post<SignInResponse>('/api/auth/email/verify', { email, code }, { schema: SignInResponseSchema });
}

/** POST /api/auth/google { credential } → sets the session cookie. */
export function signInWithGoogle(credential: string): Promise<SignInResponse> {
  return api.post<SignInResponse>('/api/auth/google', { credential }, { schema: SignInResponseSchema });
}
