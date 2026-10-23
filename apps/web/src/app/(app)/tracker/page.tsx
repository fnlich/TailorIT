import type { Metadata } from 'next';
import { TrackerPage } from '@/features/tracker/TrackerPage';

export const metadata: Metadata = { title: 'Job Tracker' };

export default function Page() {
  return <TrackerPage />;
}
