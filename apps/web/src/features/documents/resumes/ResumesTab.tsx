'use client';

import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { PlusIcon } from '@/components/ui/icons';
import { DocumentCollection, DocumentNameCell, type DocumentColumn } from '../core';

/*
 * PLACEHOLDER (work package F5). Package R2 replaces this file with the real Resumes tab: GET /api/resumes, the
 * thumbnail grid + list views (free_tailor's), Upload, the All / Created / Uploaded filter and the resume menu.
 * Keep the export name: app/(app)/documents renders <ResumesTab />.
 */

interface ResumeRow {
  id: string;
  title: string;
}

const columns: DocumentColumn<ResumeRow>[] = [
  { key: 'name', header: 'Name', track: 'minmax(0,1.06fr)', cell: (row) => <DocumentNameCell name={row.title} /> },
  { key: 'created', header: 'Created', track: 'minmax(0,1fr)', cell: () => '-' },
  { key: 'edited', header: 'Last Edited', track: 'minmax(0,0.97fr)', cell: () => '-' },
];

export function ResumesTab() {
  return (
    <DocumentCollection<ResumeRow>
      kind="resume"
      noun={{ one: 'resume', many: 'resumes' }}
      items={[]}
      getId={(row) => row.id}
      getLabel={(row) => row.title}
      columns={columns}
      selectable
      empty={{
        title: 'Create your first resume!',
        description: 'Get started with a polished resume that highlights your skills and experience.',
        action: (
          <Link href="/resumes/new" className={buttonClasses()}>
            <PlusIcon size={16} />
            New Resume
          </Link>
        ),
      }}
    />
  );
}
