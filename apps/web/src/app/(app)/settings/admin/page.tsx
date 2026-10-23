import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSpinner } from '@/components/ui/Spinner';
import { AdminPage } from '@/features/settings/AdminPage';

export const metadata: Metadata = { title: 'Admin' };

export default function Page() {
  // AdminPage reads ?tab= (useSearchParams), which needs a Suspense boundary when prerendered.
  return (
    <Suspense fallback={<PageSpinner />}>
      <AdminPage />
    </Suspense>
  );
}
