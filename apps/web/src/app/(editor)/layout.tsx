import { AuthGate } from '@/components/shell/AuthGate';
import { AuthProvider } from '@/lib/auth';

/** Full-screen editors: no app header; each editor draws its own EditorBar over the #f8f8f8 canvas. */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh flex-col bg-surface-low">
        <AuthGate>{children}</AuthGate>
      </div>
    </AuthProvider>
  );
}
