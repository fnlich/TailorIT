import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KitShowcase } from '@/features/dev-kit/KitShowcase';

export const metadata: Metadata = { title: 'UI kit', robots: { index: false } };

/** Every kit component on fake data, for visual checks without the API. Not served in production. */
export default function KitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <KitShowcase />;
}
