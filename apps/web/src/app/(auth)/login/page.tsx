import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Logo } from '@/components/shell/Logo';
import { SignInPage } from '@/features/auth/SignInPage';

export const metadata: Metadata = { title: 'Sign in' };

/** What the prerendered HTML shows until the page (which reads ?next=) runs in the browser. */
function SignInFallback() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="mb-8 flex items-center">
        <Logo markSize={40} wordSize={28} gap={10} />
      </div>
      <div className="w-full max-w-md rounded-surface border border-border bg-surface p-6 shadow-soft sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">TailorIT keeps your resumes to your own account.</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInPage />
    </Suspense>
  );
}
