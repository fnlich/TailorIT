import { describe, expect, it } from 'vitest';
import { hideColumn, readColumnPrefs, showColumn, visibleColumns, columnMode } from './board';
import { formatDays, insights, mostActiveDayLabel, sankeyData, type ChartApplication } from './chart';
import type { StatusEvent } from './rules';
import type { ApplicationStatus } from './statuses';

const app = (title: string, ...events: Array<[ApplicationStatus, string]>): ChartApplication => ({
  title,
  companyName: `${title} Co`,
  events: events.map(([status, occurredOn]): StatusEvent => ({ status, occurredOn })),
});

describe('board columns', () => {
  it('shows forced columns always and default ones only with cards', () => {
    expect(visibleColumns({}, {})).toEqual([1, 2, 12, 13, 23]);
    expect(visibleColumns({}, { 11: 3, '22': 1 })).toEqual([1, 2, 11, 12, 13, 22, 23]);
  });

  it('hides and forces columns by preference', () => {
    let prefs = hideColumn({}, 12);
    expect(visibleColumns(prefs, { 12: 5 })).toEqual([1, 2, 13, 23]);
    prefs = showColumn(prefs, 24);
    expect(visibleColumns(prefs, {})).toEqual([1, 2, 13, 23, 24]);
    expect(columnMode(prefs, 11)).toBe('default');
  });

  it('reads stored preferences defensively', () => {
    expect(readColumnPrefs('{"12":"hidden","99":"forced","11":"weird","24":"forced"}')).toEqual({
      12: 'hidden',
      24: 'forced',
    });
    expect(readColumnPrefs('not json')).toEqual({});
    expect(readColumnPrefs(null)).toEqual({});
  });
});

describe('sankeyData', () => {
  it('links consecutive stages from Applied on and counts each node', () => {
    const data = sankeyData([
      app('A', [1, '2026-10-01'], [2, '2026-10-02'], [11, '2026-10-05'], [12, '2026-10-09'], [23, '2026-10-15']),
      app('B', [1, '2026-10-01'], [2, '2026-10-02'], [12, '2026-10-06']),
      app('C', [1, '2026-10-01'], [2, '2026-10-03'], [22, '2026-10-20']),
      app('D', [1, '2026-10-01']),
    ]);
    expect(data.total).toBe(3);
    expect(data.nodes.map((node) => [node.id, node.value])).toEqual([
      ['Applied', 3],
      ['Screening', 1],
      ['Interviewing', 2],
      ['Ghosted', 1],
      ['Rejected', 1],
    ]);
    expect(data.links).toEqual([
      { source: 'Applied', target: 'Screening', value: 1 },
      { source: 'Screening', target: 'Interviewing', value: 1 },
      { source: 'Interviewing', target: 'Rejected', value: 1 },
      { source: 'Applied', target: 'Interviewing', value: 1 },
      { source: 'Applied', target: 'Ghosted', value: 1 },
    ]);
    expect(data.nodes[0]?.color).toBe('#4a86e8');
  });

  it('starts an imported history without Applied at Applied', () => {
    const data = sankeyData([app('X', [1, '2026-10-01'], [11, '2026-10-02'], [23, '2026-10-03'])]);
    expect(data.links).toEqual([
      { source: 'Applied', target: 'Screening', value: 1 },
      { source: 'Screening', target: 'Rejected', value: 1 },
    ]);
    expect(data.nodes.map((node) => node.id)).toEqual(['Applied', 'Screening', 'Rejected']);
  });

  it('is empty without applied applications', () => {
    expect(sankeyData([app('D', [1, '2026-10-01'])])).toEqual({ nodes: [], links: [], total: 0 });
  });
});

describe('insights', () => {
  // Applied dates: Mon 10/5, Mon 10/12, Tue 10/13, Wed 10/14; today Thu 10/22 (18 days since the first).
  const apps = [
    app('Alpha', [1, '2026-10-01'], [2, '2026-10-05'], [11, '2026-10-07'], [12, '2026-10-10'], [13, '2026-10-20']),
    app('Beta', [1, '2026-10-01'], [2, '2026-10-12'], [11, '2026-10-16'], [23, '2026-10-18']),
    app('Gamma', [1, '2026-10-01'], [2, '2026-10-13'], [22, '2026-10-21']),
    app('Delta', [1, '2026-10-01'], [2, '2026-10-14']),
    app('Saved only', [1, '2026-10-02']),
  ];
  const result = insights(apps, new Date(2026, 9, 22, 12));

  it('measures activity over applied applications', () => {
    expect(result.activity.total).toBe(4);
    expect(result.activity.mostActiveDay).toEqual({ weekday: 'Monday', count: 2 });
    expect(result.activity.perDay).toBe(0.2);
    expect(result.activity.perWeek).toBe(1.6);
    expect(result.activity.perMonth).toBe(4);
  });

  it('computes the conversion funnel', () => {
    expect(result.funnel.appliedToScreening).toEqual({ percent: 50, from: 4, to: 2 });
    expect(result.funnel.screeningToInterview).toEqual({ percent: 50, from: 2, to: 1 });
    expect(result.funnel.interviewToOffer).toEqual({ percent: 100, from: 1, to: 1 });
  });

  it('computes response time, ghost rate and the longest wait', () => {
    // Alpha answered after 2 days (Screen), Beta after 4 (Screen); Gamma ghosted; Delta still waiting 8 days.
    expect(result.response.averageResponseDays).toBe(3);
    expect(result.response.ghostRate).toBe(25);
    expect(result.response.longestWait).toEqual({ days: 8, title: 'Delta', companyName: 'Delta Co' });
  });

  it('answers zeros and nulls with nothing applied', () => {
    const empty = insights([app('Saved only', [1, '2026-10-02'])], new Date(2026, 9, 22));
    expect(empty.activity).toEqual({ total: 0, mostActiveDay: null, perDay: 0, perWeek: 0, perMonth: 0 });
    expect(empty.funnel.appliedToScreening.percent).toBe(0);
    expect(empty.response).toEqual({ averageResponseDays: null, ghostRate: 0, longestWait: null });
  });

  it('labels the cards', () => {
    expect(mostActiveDayLabel({ weekday: 'Monday', count: 1 })).toBe('Monday (1 app)');
    expect(mostActiveDayLabel({ weekday: 'Friday', count: 4 })).toBe('Friday (4 apps)');
    expect(formatDays(3)).toBe('3 days');
    expect(formatDays(null)).toBe('-');
  });
});
