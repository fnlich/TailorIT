'use client';

import { MeResponseSchema, type Account, type MeResponse } from '@tailorit/shared/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from './api';

/** React Query key of GET /api/auth/me. Sign-in and rename put the new account here with setQueryData. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/auth/me', { schema: MeResponseSchema, signal });
}

export interface AuthState {
  /** The signed-in account; null while loading, on error, or when the session is gone. */
  account: Account | null;
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  isAdmin: boolean;
  signingOut: boolean;
  /** POST /api/auth/logout, then a full-page move to /login. */
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Replaces the cached account (after a rename) without a refetch. */
  setAccount: (account: Account | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Loads the session's account once and shares it with everything below. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 5 * 60_000,
  });
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Leaving is what was asked for; a failed call still ends on the sign-in page.
    }
    queryClient.clear();
    // A full page load (not a router push), so no signed-in state survives in memory.
    window.location.assign(new URL('/login', window.location.origin).href);
  }, [queryClient]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const setAccount = useCallback(
    (account: Account | null) => queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, { account }),
    [queryClient],
  );

  const account = query.data?.account ?? null;
  const status: AuthState['status'] = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';
  const error = query.error instanceof ApiError ? query.error : null;

  const value = useMemo<AuthState>(
    () => ({
      account,
      status,
      error,
      isAdmin: account?.role === 'admin',
      signingOut,
      signOut,
      refresh,
      setAccount,
    }),
    [account, status, error, signingOut, signOut, refresh, setAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * A fixed account with no API behind it: the dev kit page and component tests. Sign-out only calls `onSignOut`.
 */
export function StaticAuthProvider({
  account,
  onSignOut,
  children,
}: {
  account: Account | null;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const value = useMemo<AuthState>(
    () => ({
      account,
      status: 'ready',
      error: null,
      isAdmin: account?.role === 'admin',
      signingOut: false,
      signOut: async () => onSignOut?.(),
      refresh: async () => undefined,
      setAccount: () => undefined,
    }),
    [account, onSignOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() needs an <AuthProvider> (or <StaticAuthProvider>) above it.');
  return value;
}

/** The signed-in account, or null while it loads. */
export function useAccount(): Account | null {
  return useAuth().account;
}
