'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CirclesFourIcon, FileTextIcon, PlusIcon } from '@/components/ui/icons';
import type { DocumentKind } from './core/types';

interface ActionCard {
  kind: DocumentKind;
  title: string;
  description: string;
  href: string;
  icon: ReactNode;
}

export const DOCUMENT_ACTION_CARDS: readonly ActionCard[] = [
  {
    kind: 'resume',
    title: 'New Resume',
    description: 'Build a resume from a template',
    href: '/resumes/new',
    icon: <FileTextIcon size={20} />,
  },
  {
    kind: 'cover-letter',
    title: 'New Cover Letter',
    description: 'Create and customize with AI',
    href: '/cover-letter/new',
    icon: <FileTextIcon size={20} />,
  },
  {
    kind: 'template',
    title: 'New Template',
    description: 'Create a reusable cover letter template',
    href: '/cover-letter-template/new',
    icon: <CirclesFourIcon size={20} />,
  },
];

/**
 * Simplify's "new document" cards above the tabs: white, radius 16, soft shadow, a 40 px #ccf6ff tile with a teal
 * icon, the title (16 px semibold), a 13 px muted line (up to two lines, never cut mid-word at desktop widths) and a
 * grey "+" at the right. Simplify has four; TailorIT has three, so they share the row on desktop.
 * Each carries `data-new-fallback`, where focus goes when the last document of its kind is deleted in List view.
 */
export function DocumentActionCards({ className }: { className?: string }) {
  return (
    <ul className={clsx('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {DOCUMENT_ACTION_CARDS.map((card) => (
        <li key={card.kind} className="min-w-0">
          <Link
            href={card.href}
            data-new-fallback={card.kind}
            className={clsx(
              'group flex h-[90px] items-center gap-4 rounded-surface border border-border bg-surface pr-6 pl-4 shadow-soft',
              'transition-[border-color,box-shadow] duration-150 hover:border-control-hover hover:shadow-popover',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-container text-primary-ink">
              {card.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base leading-6 font-semibold text-foreground">{card.title}</span>
              <span className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{card.description}</span>
            </span>
            <PlusIcon size={16} className="shrink-0 text-subtle-foreground transition-colors group-hover:text-primary-ink" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
