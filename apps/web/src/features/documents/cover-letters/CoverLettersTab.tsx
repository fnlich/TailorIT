'use client';

import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { PlusIcon } from '@/components/ui/icons';
import { DocumentCollection, DocumentNameCell, type DocumentColumn } from '../core';

/*
 * PLACEHOLDER (work package F5). Package C replaces this file with the real Cover Letters tab: GET
 * /api/cover-letters, Simplify's table + a thumbnail grid (view toggle), Upload, bulk delete and the letter menu.
 * Keep the export name: app/(app)/documents renders <CoverLettersTab />.
 */

interface LetterRow {
  id: string;
  title: string;
}

const columns: DocumentColumn<LetterRow>[] = [
  { key: 'name', header: 'Name', track: 'minmax(0,1.06fr)', cell: (row) => <DocumentNameCell name={row.title} /> },
  { key: 'created', header: 'Created', track: 'minmax(0,1fr)', cell: () => '-' },
  { key: 'edited', header: 'Last Edited', track: 'minmax(0,0.97fr)', cell: () => '-' },
];

export function CoverLettersTab() {
  return (
    <DocumentCollection<LetterRow>
      kind="cover-letter"
      noun={{ one: 'cover letter', many: 'cover letters' }}
      items={[]}
      getId={(row) => row.id}
      getLabel={(row) => row.title}
      columns={columns}
      selectable
      empty={{
        title: 'Create your first cover letter!',
        description: 'Get started with a personalized cover letter that highlights your qualifications.',
        action: (
          <Link href="/cover-letter/new" className={buttonClasses()}>
            <PlusIcon size={16} />
            New Cover Letter
          </Link>
        ),
      }}
    />
  );
}
