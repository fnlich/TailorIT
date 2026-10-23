import type { Metadata } from 'next';
import { NewCoverLetterPage } from '@/features/cover-letter-editor/CoverLetterEditorPage';

export const metadata: Metadata = { title: 'New cover letter' };

export default function Page() {
  return <NewCoverLetterPage />;
}
