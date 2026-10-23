import type { Metadata } from 'next';
import { ResumeEditorPage } from '@/features/resume-editor/ResumeEditorPage';

export const metadata: Metadata = { title: 'Resume' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResumeEditorPage resumeId={id} />;
}
