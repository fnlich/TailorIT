'use client';

import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { PlusIcon } from '@/components/ui/icons';
import { DocumentCollection, DocumentNameCell, type DocumentColumn } from '../core';

/*
 * PLACEHOLDER (work package F5). Package C replaces this file with the real Templates tab: GET
 * /api/cover-letter-templates, Simplify's list (System Default badge + 80-character preview), Upload, Duplicate and
 * Delete (system templates cannot be selected or deleted). Keep the export name: app/(app)/documents renders
 * <TemplatesTab />.
 */

interface TemplateRow {
  id: string;
  name: string;
}

const columns: DocumentColumn<TemplateRow>[] = [
  { key: 'name', header: 'Name', track: 'minmax(0,1.06fr)', cell: (row) => <DocumentNameCell name={row.name} /> },
  { key: 'created', header: 'Created', track: 'minmax(0,1fr)', cell: () => '-' },
  { key: 'edited', header: 'Last Edited', track: 'minmax(0,0.97fr)', cell: () => '-' },
];

export function TemplatesTab() {
  return (
    <DocumentCollection<TemplateRow>
      kind="template"
      noun={{ one: 'template', many: 'templates' }}
      items={[]}
      getId={(row) => row.id}
      getLabel={(row) => row.name}
      columns={columns}
      selectable
      empty={{
        title: 'Create your first template!',
        description: 'Get started by creating a reusable cover letter template with dynamic placeholders.',
        action: (
          <Link href="/cover-letter-template/new" className={buttonClasses()}>
            <PlusIcon size={16} />
            New Template
          </Link>
        ),
      }}
    />
  );
}
