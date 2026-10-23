import type { Metadata } from 'next';
import { ResumeEditorPage } from '@/features/resume-editor/ResumeEditorPage';

export const metadata: Metadata = { title: 'New resume' };

export default function Page() {
  return <ResumeEditorPage resumeId={null} />;
}
