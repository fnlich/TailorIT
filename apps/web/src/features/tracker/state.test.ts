import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  chooseView,
  effectiveView,
  filterChips,
  filterQuery,
  readTrackerUrl,
  toggleStatus,
  trackerSearch,
  withoutChip,
} from './state';

const params = (text: string) => new URLSearchParams(text);

describe('tracker URL state', () => {
  it('reads the view, tab and open application with safe defaults', () => {
    expect(readTrackerUrl(params(''))).toEqual({ view: 'board', tab: 'active', app: null, edit: false });
    expect(readTrackerUrl(params('view=list&tab=archived&app=abc&edit=1'))).toEqual({
      view: 'list',
      tab: 'archived',
      app: 'abc',
      edit: true,
    });
    expect(readTrackerUrl(params('view=kanban&tab=x&app=' + 'a'.repeat(80))).app).toBeNull();
  });

  it('forces a list on Archived and keeps the last view for Active', () => {
    expect(effectiveView({ view: 'board', tab: 'archived' })).toBe('list');
    expect(effectiveView({ view: 'chart', tab: 'active' })).toBe('chart');
    const archived = { view: 'board' as const, tab: 'archived' as const, app: null, edit: false };
    expect(chooseView(archived, 'chart')).toMatchObject({ view: 'chart', tab: 'active' });
    expect(chooseView(archived, 'list')).toMatchObject({ view: 'list', tab: 'archived' });
  });

  it('writes only what differs from the defaults and keeps other parameters', () => {
    expect(trackerSearch({ view: 'board', tab: 'active', app: null, edit: false })).toBe('');
    expect(trackerSearch({ view: 'list', tab: 'archived', app: 'x1', edit: true }, params('utm=1&view=chart'))).toBe(
      '?utm=1&view=list&tab=archived&app=x1&edit=1',
    );
    // Edit mode only with an open application.
    expect(trackerSearch({ view: 'chart', tab: 'active', app: null, edit: true })).toBe('?view=chart');
  });
});

describe('filters', () => {
  it('turns the Options menu into API query parameters', () => {
    expect(filterQuery(DEFAULT_FILTERS, '  ')).toEqual({
      q: undefined,
      statuses: undefined,
      jobType: undefined,
      favorites: undefined,
      from: undefined,
      until: undefined,
      sort: 'tracked',
      order: 'desc',
    });
    expect(
      filterQuery(
        { ...DEFAULT_FILTERS, statuses: [2, 12], jobType: 'internship', favorites: true, from: '2026-10-01', sort: 'title', order: 'asc' },
        ' acme ',
      ),
    ).toEqual({
      q: 'acme',
      statuses: '2,12',
      jobType: 'internship',
      favorites: 1,
      from: '2026-10-01',
      until: undefined,
      sort: 'title',
      order: 'asc',
    });
  });

  it('lists chips, counts filters (not the sort) and removes one chip at a time', () => {
    const filters = { ...DEFAULT_FILTERS, statuses: [2, 23] as const, favorites: true, sort: 'title' as const };
    const chips = filterChips({ ...filters, statuses: [...filters.statuses] });
    expect(chips.map((chip) => chip.label)).toEqual(['Applied', 'Rejected', 'Favorites', 'Sort: title (desc)']);
    expect(activeFilterCount({ ...filters, statuses: [...filters.statuses] })).toBe(3);
    const rejected = chips.find((chip) => chip.label === 'Rejected')!;
    expect(withoutChip({ ...filters, statuses: [...filters.statuses] }, rejected).statuses).toEqual([2]);
    const sort = chips.find((chip) => chip.key === 'sort')!;
    expect(withoutChip({ ...filters, statuses: [] }, sort)).toMatchObject({ sort: 'tracked', order: 'desc' });
  });

  it('keeps ticked statuses in status order', () => {
    expect(toggleStatus([12], 2, true)).toEqual([2, 12]);
    expect(toggleStatus([2, 12], 12, false)).toEqual([2]);
    expect(toggleStatus([2], 2, true)).toEqual([2]);
  });
});
