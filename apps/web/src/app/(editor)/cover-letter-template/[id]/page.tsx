import type { Metadata } from 'next';
import { TemplateEditorPage } from '@/features/template-editor/TemplateEditorPage';

export const metadata: Metadata = { title: 'Template' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditorPage templateId={id} />;
}
