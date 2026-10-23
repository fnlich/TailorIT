import type { Metadata } from 'next';
import { CoverLetterEditorPage } from '@/features/cover-letter-editor/CoverLetterEditorPage';

export const metadata: Metadata = { title: 'Cover letter' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CoverLetterEditorPage letterId={id} />;
}
