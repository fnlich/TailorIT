import { describe, expect, it } from 'vitest';
import { annualize, parseSalary, toAnnualUsd, type ParsedSalary } from './salary';

const salary = (
  min: number | null,
  max: number | null,
  currency: string | null,
  period: ParsedSalary['period'],
): ParsedSalary => ({ min, max, currency, period });

describe('parseSalary', () => {
  it.each([
    ['$120,000 - $150,000', salary(120000, 150000, 'USD', 'year')],
    ['$60/hr', salary(60, 60, 'USD', 'hour')],
    ['£325k–£390k', salary(325000, 390000, 'GBP', 'year')],
    ['120K – 150K', salary(120000, 150000, null, 'year')],
    ['USD 100k', salary(100000, 100000, 'USD', 'year')],
    ['$120,000.00 - $150,000.00 USD', salary(120000, 150000, 'USD', 'year')],
    ['€50.000 - €60.000', salary(50000, 60000, 'EUR', 'year')],
    ['CA$90,000 - CA$110,000', salary(90000, 110000, 'CAD', 'year')],
    ['18 - 25 USD per hour', salary(18, 25, 'USD', 'hour')],
    ['$50–$60 an hour', salary(50, 60, 'USD', 'hour')],
    ['$5,000 - $7,000 per month', salary(5000, 7000, 'USD', 'month')],
    ['$120k/yr - $150k/yr', salary(120000, 150000, 'USD', 'year')],
    ['120-150k', salary(120000, 150000, null, 'year')],
    ['$1.2M - $1.5M', salary(1_200_000, 1_500_000, 'USD', 'year')],
    ['₹12-15 LPA', salary(1_200_000, 1_500_000, 'INR', 'year')],
    ['$100k+', salary(100000, null, 'USD', 'year')],
    ['Up to $150,000 a year', salary(null, 150000, 'USD', 'year')],
    ['Starting at $25/hour', salary(25, null, 'USD', 'hour')],
    ['Between $100k and $120k', salary(100000, 120000, 'USD', 'year')],
    ['100000-120000', salary(100000, 120000, null, 'year')],
    ['Salary: 100000 - 120000', salary(100000, 120000, null, 'year')],
    ['Pay: 25-30/hr', salary(25, 30, null, 'hour')],
    ['$4,000 bi-weekly', salary(2000, 2000, 'USD', 'week')],
    ['$150,000 - $120,000', salary(120000, 150000, 'USD', 'year')],
    ['$40 - $50', salary(40, 50, 'USD', 'hour')],
    ['£40,000 - £50,000 per annum', salary(40000, 50000, 'GBP', 'year')],
  ])('%s', (text, expected) => {
    expect(parseSalary(text)).toEqual(expected);
  });

  it.each([
    ['$100,000 - $120,000 CAD', salary(100000, 120000, 'CAD', 'year')],
    ['$80,000 - $100,000 AUD', salary(80000, 100000, 'AUD', 'year')],
    ['CAD $90,000 - $110,000', salary(90000, 110000, 'CAD', 'year')],
    ['Salary (CAD): $90,000 - $110,000', salary(90000, 110000, 'CAD', 'year')],
    ['€12,50 per hour', salary(12.5, 12.5, 'EUR', 'hour')],
    ['65.000 € - 75.000 €', salary(65000, 75000, 'EUR', 'year')],
    ['50.000€ - 60.000€', salary(50000, 60000, 'EUR', 'year')],
    ['45 000 € - 55 000 €', salary(45000, 55000, 'EUR', 'year')],
    ["CHF 120'000 - 140'000", salary(120000, 140000, 'CHF', 'year')],
    ['$120,000 − $150,000', salary(120000, 150000, 'USD', 'year')],
    ['10,00,000 INR', salary(1_000_000, 1_000_000, 'INR', 'year')],
    ['401k match. Salary: $150k', salary(150000, 150000, 'USD', 'year')],
    ['Salary $100k and 401k match', salary(100000, 100000, 'USD', 'year')],
    ['$80,000 - $100,000 base; hybrid 3 days a week', salary(80000, 100000, 'USD', 'year')],
    ['USD 25/hr', salary(25, 25, 'USD', 'hour')],
  ])('reads %s', (text, expected) => {
    expect(parseSalary(text)).toEqual(expected);
  });

  it('finds the range inside a sentence', () => {
    expect(parseSalary('We have 5 offices. The base salary range is $130,000 to $160,000 per year plus equity.')).toEqual(
      salary(130000, 160000, 'USD', 'year'),
    );
  });

  it.each([
    '5+ years of experience',
    'We match your 401(k)',
    'Benefits include 401k matching',
    '2020 - 2024',
    'Competitive',
    '',
    'try 100 times',
    'Hybrid: 2-3 days a week in office',
    '20 days PTO per year',
    'Up to 20% bonus annually',
    'Experience with PHP 7',
    'We serve 10,000 to 50,000 customers daily',
  ])(
    'finds no salary in %s',
    (text) => {
      expect(parseSalary(text)).toBeNull();
    },
  );
});

describe('annualize and toAnnualUsd', () => {
  it('annualizes each period', () => {
    expect(annualize(50, 'hour')).toBe(104000);
    expect(annualize(500, 'day')).toBe(130000);
    expect(annualize(2000, 'week')).toBe(104000);
    expect(annualize(4000, 'biweek')).toBe(104000);
    expect(annualize(10000, 'month')).toBe(120000);
    expect(annualize(120000, 'year')).toBe(120000);
    expect(annualize(120000, null)).toBe(120000);
  });

  it('converts to yearly US dollars with the static table', () => {
    expect(toAnnualUsd(100000, 120000, 'GBP', 'year')).toEqual({ min: 127000, max: 152400 });
    expect(toAnnualUsd(60, null, null, 'hour')).toEqual({ min: 124800, max: null });
    expect(toAnnualUsd(100, 200, 'XXX', 'year')).toBeNull();
    expect(toAnnualUsd(null, null, 'USD', 'year')).toBeNull();
  });
});
