import { AppHeader } from '@/components/shell/AppHeader';
import { AuthGate } from '@/components/shell/AuthGate';
import { AuthProvider } from '@/lib/auth';

/** The signed-in app: Simplify's header over the #fcfcfc canvas. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <AppHeader />
        <main className="flex flex-1 flex-col">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </AuthProvider>
  );
}
