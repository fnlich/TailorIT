import { describe, expect, it } from 'vitest';
import {
  appliedChipLabel,
  compactAmount,
  formatLocationLine,
  formatSalaryRange,
  liveChip,
  salaryLabel,
} from './format';

describe('formatSalaryRange', () => {
  it.each([
    [120000, 150000, 'USD', 'year', '$120k - $150k/yr'],
    [325000, 390000, 'GBP', 'year', '£325k - £390k/yr'],
    [60, 60, 'USD', 'hour', '$60/hr'],
    [62.5, 75, 'USD', 'hour', '$62.50 - $75/hr'],
    [125500, 140000, 'EUR', 'year', '€125.5k - €140k/yr'],
    [90000, 110000, 'CAD', 'year', 'CA$90k - CA$110k/yr'],
    [1_200_000, 1_500_000, 'INR', 'year', '₹1.2M - ₹1.5M/yr'],
    [5000, 7000, 'USD', 'month', '$5k - $7k/mo'],
    [100000, null, 'USD', 'year', '$100k+/yr'],
    [null, 150000, 'USD', 'year', 'Up to $150k/yr'],
    [150000, 120000, 'USD', 'year', '$120k - $150k/yr'],
    [80000, 90000, 'XYZ', null, 'XYZ 80k - XYZ 90k'],
  ] as const)('%s-%s %s %s', (min, max, currency, period, expected) => {
    expect(formatSalaryRange(min, max, currency, period)).toBe(expected);
  });

  it('prints nothing without an amount, and "No salary listed" in the facts grid', () => {
    expect(formatSalaryRange(null, null, 'USD', 'year')).toBe('');
    expect(salaryLabel(null)).toBe('No salary listed');
    expect(salaryLabel({ min: 0, max: 0, currency: 'USD', period: 'year' })).toBe('No salary listed');
    expect(salaryLabel({ min: 100000, max: 120000, currency: null, period: 'year' })).toBe('$100k - $120k/yr');
  });

  it('compacts amounts', () => {
    expect(compactAmount(999)).toBe('999');
    expect(compactAmount(99950)).toBe('100k');
    expect(compactAmount(1_250_000)).toBe('1.25M');
  });
});

describe('formatLocationLine', () => {
  it('joins place, extra count and arrangement', () => {
    expect(formatLocationLine('Fremont, CA, USA', 1, 'onsite')).toBe('Fremont, CA, USA · In Person');
    expect(formatLocationLine('Fremont, CA, USA', 3, 'hybrid')).toBe('Fremont, CA, USA + 2 more · Hybrid');
    expect(formatLocationLine('Remote in USA', 1, 'remote')).toBe('Remote in USA · Remote');
    expect(formatLocationLine('Austin, TX, USA', 1, null)).toBe('Austin, TX, USA');
    expect(formatLocationLine('', 4, 'remote')).toBe('4 locations · Remote');
    expect(formatLocationLine('', 0, null)).toBe('');
  });
});

describe('liveChip', () => {
  const now = new Date(2026, 9, 22, 12);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it('says posted for a recent posting', () => {
    expect(liveChip({ active: true, postedAt: daysAgo(2), updatedAt: daysAgo(1) }, now)).toEqual({
      kind: 'posted',
      label: 'Posted on Oct 20, 2026',
    });
  });

  it('says updated for an older posting updated this week', () => {
    expect(liveChip({ active: true, postedAt: daysAgo(30), updatedAt: daysAgo(3) }, now).kind).toBe('updated');
  });

  it('says confirmed live for an older active posting', () => {
    expect(liveChip({ active: true, postedAt: daysAgo(30), updatedAt: daysAgo(20) }, now)).toEqual({
      kind: 'live',
      label: 'Confirmed live in the last 24 hours',
    });
  });

  it('always shows the posted date of an inactive posting', () => {
    expect(liveChip({ active: false, postedAt: daysAgo(60), updatedAt: daysAgo(1) }, now).kind).toBe('posted');
    expect(liveChip({ active: false }, now).kind).toBe('inactive');
  });
});

describe('appliedChipLabel', () => {
  it('prints M/D/YY', () => {
    expect(appliedChipLabel('2026-10-22')).toBe('Applied 10/22/26');
  });
});
