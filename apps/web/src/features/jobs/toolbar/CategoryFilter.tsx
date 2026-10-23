'use client';

import { JOB_CATEGORIES, jobFilterCounts, type JobFacetItem, type JobsQuery } from '@tailorit/shared';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { FilterPill } from '@/components/ui/FilterPill';
import { CaretDownIcon, CaretRightIcon, MagnifyingGlassIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Skeleton } from '@/components/ui/Skeleton';
import { toggled } from '../filters';
import { useFacet } from '../hooks';

interface CategoryNode {
  id: string;
  label: string;
  count: number;
  children: JobFacetItem[];
}

const TAXONOMY_ORDER = new Map<string, number>(JOB_CATEGORIES.map((category, index) => [category.id, index]));

function includes(label: string, text: string): boolean {
  return label.toLowerCase().includes(text.toLowerCase());
}

/**
 * The category facets with job counts, most jobs first, each with its subcategories one click away. Searching
 * matches categories and subcategories alike. Ticking applies at once.
 */
export function CategoryPicker({
  query,
  onChange,
  className,
}: {
  query: Pick<JobsQuery, 'categories' | 'subcategories'>;
  onChange: (patch: Partial<JobsQuery>) => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const categories = useFacet('categories', '');
  const subcategories = useFacet('subcategories', '');

  const tree = useMemo<CategoryNode[]>(() => {
    const children = new Map<string, JobFacetItem[]>();
    for (const item of subcategories.data?.items ?? []) {
      if (!item.parent) continue;
      children.set(item.parent, [...(children.get(item.parent) ?? []), item]);
    }
    return (categories.data?.items ?? [])
      .map((item) => ({ id: item.value, label: item.label, count: item.count, children: children.get(item.value) ?? [] }))
      .sort((a, b) => b.count - a.count || (TAXONOMY_ORDER.get(a.id) ?? 99) - (TAXONOMY_ORDER.get(b.id) ?? 99));
  }, [categories.data, subcategories.data]);

  const search = text.trim();
  const visible = tree
    .map((node) => {
      if (!search || includes(node.label, search)) return { node, children: node.children, forced: false };
      const children = node.children.filter((child) => includes(child.label, search));
      return children.length > 0 ? { node, children, forced: true } : null;
    })
    .filter((entry): entry is { node: CategoryNode; children: JobFacetItem[]; forced: boolean } => entry !== null);

  const toggleOpen = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={clsx('flex flex-col', className)}>
      <div className="p-3">
        <Input
          aria-label="Search categories"
          placeholder="Search categories"
          leading={<MagnifyingGlassIcon size={16} />}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <ul className="max-h-[300px] overflow-y-auto border-t border-border p-1.5" aria-label="Categories">
        {categories.isPending ? (
          Array.from({ length: 5 }, (_, index) => (
            <li key={index} className="px-1.5 py-2">
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))
        ) : visible.length === 0 ? (
          <li className="px-1.5 py-2 text-sm text-muted-foreground">
            {search ? 'No categories match.' : 'No categories yet.'}
          </li>
        ) : (
          visible.map(({ node, children, forced }) => {
            const expanded =
              forced || open.has(node.id) || node.children.some((child) => (query.subcategories as readonly string[]).includes(child.value));
            const checked = (query.categories as readonly string[]).includes(node.id);
            return (
              <li key={node.id}>
                <div className="flex min-h-8 items-center gap-1 rounded-menu-row pr-1.5 hover:bg-hover">
                  <button
                    type="button"
                    aria-label={expanded ? `Hide ${node.label} subcategories` : `Show ${node.label} subcategories`}
                    aria-expanded={expanded}
                    disabled={children.length === 0}
                    onClick={() => toggleOpen(node.id)}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground disabled:invisible"
                  >
                    {expanded ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
                  </button>
                  <Checkbox
                    label={<span className="truncate">{node.label}</span>}
                    checked={checked}
                    onCheckedChange={(on) =>
                      onChange({ categories: toggled<string>(query.categories, node.id, on) as JobsQuery['categories'] })
                    }
                    className="min-w-0 flex-1 py-1.5"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">{node.count.toLocaleString('en-US')}</span>
                </div>
                {expanded && children.length > 0 && (
                  <ul className="pl-7" aria-label={`${node.label} subcategories`}>
                    {children.map((child) => (
                      <li key={child.value} className="flex min-h-8 items-center gap-1 rounded-menu-row pr-1.5 pl-1.5 hover:bg-hover">
                        <Checkbox
                          label={<span className="truncate">{child.label}</span>}
                          checked={checked || (query.subcategories as readonly string[]).includes(child.value)}
                          disabled={checked}
                          onCheckedChange={(on) =>
                            onChange({
                              subcategories: toggled<string>(query.subcategories, child.value, on) as JobsQuery['subcategories'],
                            })
                          }
                          className="min-w-0 flex-1 py-1.5"
                        />
                        <span className="text-xs text-muted-foreground tabular-nums">{child.count.toLocaleString('en-US')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/** The toolbar's "Category [n]" pill and its searchable list. */
export function CategoryFilter({ query, onChange }: { query: JobsQuery; onChange: (patch: Partial<JobsQuery>) => void }) {
  const count = jobFilterCounts(query).category;
  return (
    <Popover>
      <PopoverTrigger render={<FilterPill label="Category" count={count} active={count > 0} />} />
      <PopoverContent align="end" padding="none" className="w-[360px]" aria-label="Category">
        <CategoryPicker query={query} onChange={onChange} />
        {count > 0 && (
          <div className="flex justify-end border-t border-border px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => onChange({ categories: [], subcategories: [] })}>
              Clear category
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
