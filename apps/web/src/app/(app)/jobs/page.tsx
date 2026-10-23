import type { Metadata } from 'next';
import { JobsPage } from '@/features/jobs/JobsPage';

export const metadata: Metadata = { title: 'Jobs' };

export default function Page() {
  return <JobsPage />;
}
