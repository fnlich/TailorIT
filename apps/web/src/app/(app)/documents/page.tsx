import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSpinner } from '@/components/ui/Spinner';
import { DocumentsPage } from '@/features/documents/DocumentsPage';

export const metadata: Metadata = { title: 'Documents' };

export default function Page() {
  // DocumentsPage reads ?tab= (useSearchParams), which needs a Suspense boundary when prerendered.
  return (
    <Suspense fallback={<PageSpinner />}>
      <DocumentsPage />
    </Suspense>
  );
}
