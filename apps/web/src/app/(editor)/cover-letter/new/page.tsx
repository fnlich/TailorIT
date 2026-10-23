import type { Metadata } from 'next';
import { NewCoverLetterPage } from '@/features/cover-letter-editor/CoverLetterEditorPage';

export const metadata: Metadata = { title: 'New cover letter' };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.trim() || undefined;
}

/** /cover-letter/new[?applicationId=|?trackerId=][&jobId=][&templateId=] */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const jobId = Number(first(params.jobId));
  return (
    <NewCoverLetterPage
      applicationId={first(params.applicationId) ?? first(params.trackerId)}
      jobId={Number.isInteger(jobId) && jobId > 0 ? jobId : undefined}
      templateId={first(params.templateId)}
    />
  );
}
