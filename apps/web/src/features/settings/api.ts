import { AccountSchema, EMPTY_PREFERENCES, PreferencesSchema, type Account, type Preferences } from '@tailorit/shared/auth';
import { api } from '@/lib/api';

export const PREFERENCES_QUERY_KEY = ['me', 'preferences'] as const;

/** Accepts the preferences object itself or `{ preferences }`; fills anything missing with the empty defaults. */
function readPreferences(data: unknown): Preferences {
  const record = data && typeof data === 'object' && 'preferences' in data ? (data as { preferences: unknown }).preferences : data;
  const merged = { ...EMPTY_PREFERENCES, ...(record && typeof record === 'object' ? record : {}) };
  const parsed = PreferencesSchema.safeParse(merged);
  return parsed.success ? parsed.data : EMPTY_PREFERENCES;
}

/** GET /api/me/preferences */
export async function fetchPreferences(signal?: AbortSignal): Promise<Preferences> {
  return readPreferences(await api.get('/api/me/preferences', { signal }));
}

/** PUT /api/me/preferences (the whole object). */
export async function savePreferences(preferences: Preferences): Promise<Preferences> {
  return readPreferences(await api.put('/api/me/preferences', preferences));
}

/** PATCH /api/me { name } → the updated account (accepts `{ account }` or the account itself). */
export async function renameAccount(name: string): Promise<Account | null> {
  const data = await api.patch<unknown>('/api/me', { name });
  const record = data && typeof data === 'object' && 'account' in data ? (data as { account: unknown }).account : data;
  const parsed = AccountSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}
