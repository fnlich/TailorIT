'use client';

import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { UNREACHABLE_MESSAGE } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { redirectToLogin } from '@/lib/navigation';

/**
 * Shows `children` only once the session's account is known. No account (an expired or revoked cookie) → the
 * sign-in page, remembering this one; the API unreachable → a sentence and Try again.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { account, status, error, refresh } = useAuth();
  const signedOut = status === 'ready' && account === null;

  useEffect(() => {
    if (signedOut) redirectToLogin();
  }, [signedOut]);

  if (status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-16">
        <Notice
          tone="error"
          title="TailorIT could not load your account"
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        >
          {error?.isUnreachable || !error ? UNREACHABLE_MESSAGE : error.message}
        </Notice>
      </div>
    );
  }
  if (status === 'loading' || !account) return <PageSpinner label={signedOut ? 'Opening the sign-in page...' : 'Loading...'} />;
  return <>{children}</>;
}
