import type { Metadata } from 'next';
import { NewTemplatePage } from '@/features/template-editor/TemplateEditorPage';

export const metadata: Metadata = { title: 'New template' };

export default function Page() {
  return <NewTemplatePage />;
}
