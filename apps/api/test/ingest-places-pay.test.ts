import { describe, expect, it } from 'vitest';
import { normalizePosting, normalizeSalary, salaryFromText } from '../src/features/ingest/normalize';
import type { RawPosting } from '../src/features/ingest/types';

// Places and pay as job boards and postings write them, through ingestion's normalisation (the shared parsers plus
// the board's country hint, the arrangement rules and the yearly-USD conversion behind the salary slider).

function posting(locations: string[], extra: Partial<RawPosting> = {}): RawPosting {
  return {
    sourceJobId: '1',
    title: 'Software Engineer',
    company: { name: 'Acme' },
    descriptionHtml: '<p>Build things.</p>',
    url: 'https://jobs.example.com/1',
    locations,
    ...extra,
  };
}

/** [location text, primary place as shown, number of places, arrangement read from the place] */
const PLACES: Array<[string, string, number, 'remote' | 'hybrid' | 'onsite' | null]> = [
  ['Remote, United States', 'Remote in USA', 1, 'remote'],
  ['Remote Ireland; Remote, Israel', 'Remote in Ireland', 2, 'remote'],
  ['Remote, Canada; Remote, United Kingdom; Remote, United States', 'Remote in Canada', 3, 'remote'],
  ['Bangalore, India; Remote, Australia', 'Bengaluru, India', 2, 'remote'],
  ['New York, NY (HQ)', 'New York, NY, USA', 1, null],
  ['Remote (US)', 'Remote in USA', 1, 'remote'],
  ['Remote (Canada)', 'Remote in Canada', 1, 'remote'],
  ['Miami, FL', 'Miami, FL, USA', 1, null],
  ['San Francisco, CA', 'San Francisco, CA, USA', 1, null],
  ['Singapore, Singapore', 'Singapore', 1, null],
  ['London, United Kingdom', 'London, UK', 1, null],
  ['Washington, D.C.', 'Washington, DC, USA', 1, null],
  ['Palo Alto, CA', 'Palo Alto, CA, USA', 1, null],
  ['Remote - North America', 'Remote', 1, 'remote'],
  ['Remote - Europe', 'Remote', 1, 'remote'],
  ['North America', 'North America', 1, null],
  ['Toronto, ON, Canada', 'Toronto, ON, Canada', 1, null],
  ['Toronto, Ontario', 'Toronto, ON, Canada', 1, null],
  ['Berlin, Germany', 'Berlin, Germany', 1, null],
  ['Amsterdam, Netherlands', 'Amsterdam, Netherlands', 1, null],
  ['Dublin, Ireland', 'Dublin, Ireland', 1, null],
  ['Sydney, Australia', 'Sydney, Australia', 1, null],
  ['Austin, TX', 'Austin, TX, USA', 1, null],
  ['Boston, MA / New York, NY', 'Boston, MA, USA', 2, null],
  ['Seattle, WA or Remote', 'Seattle, WA, USA', 2, 'remote'],
  ['Hybrid - Chicago, IL', 'Chicago, IL, USA', 1, 'hybrid'],
  ['On-site - Denver, CO', 'Denver, CO, USA', 1, 'onsite'],
  ['Remote in USA', 'Remote in USA', 1, 'remote'],
  ['US Remote', 'Remote in USA', 1, 'remote'],
  ['Remote - US', 'Remote in USA', 1, 'remote'],
  ['Remote', 'Remote', 1, 'remote'],
  ['Anywhere', 'Remote', 1, 'remote'],
  ['Multiple Locations', 'Multiple Locations', 1, null],
  ['Remote, EMEA', 'Remote', 1, 'remote'],
  ['São Paulo, Brazil', 'São Paulo, Brazil', 1, null],
  ['Mexico City, Mexico', 'Mexico City, Mexico', 1, null],
  ['Paris, France', 'Paris, France', 1, null],
  ['Tokyo, Japan', 'Tokyo, Japan', 1, null],
  ['Pittsburgh, PA (Hybrid)', 'Pittsburgh, PA, USA', 1, 'hybrid'],
  ['McLean, VA (Remote)', 'Remote in USA', 1, 'remote'],
  ['Remote, US or Canada', 'Remote in USA', 2, 'remote'],
  ['Chicago', 'Chicago, IL, USA', 1, null],
  ['Bengaluru, Karnataka, India', 'Bengaluru, Karnataka, India', 1, null],
  ['Zurich, Switzerland', 'Zurich, Switzerland', 1, null],
  ['Tel Aviv, Israel', 'Tel Aviv, Israel', 1, null],
  ['Remote (EST)', 'Remote', 1, 'remote'],
  ['New York City', 'New York, NY, USA', 1, null],
  ['Los Angeles, California, United States', 'Los Angeles, CA, USA', 1, null],
];

describe(`places (${PLACES.length} location texts)`, () => {
  it.each(PLACES)('%s', (text, primary, count, arrangement) => {
    const job = normalizePosting(posting([text]));
    expect(job.primaryLocation).toBe(primary);
    expect(job.locationCount).toBe(count);
    expect(job.locationsText.split('; ')).toHaveLength(count);
    expect(job.workArrangement).toBe(arrangement);
  });

  it("fills a board's country into bare places but leaves named countries alone", () => {
    expect(normalizePosting(posting(['Remote'], { countryHint: 'GB' })).primaryLocation).toBe('Remote in UK');
    expect(normalizePosting(posting(['Remote - Europe'], { countryHint: 'US' })).primaryLocation).toBe('Remote in USA');
    expect(normalizePosting(posting(['Berlin, Germany'], { countryHint: 'US' })).primaryLocation).toBe('Berlin, Germany');
    expect(normalizePosting(posting(['Multiple Locations'], { countryHint: 'US' })).primaryLocation).toBe('Multiple Locations');
  });

  it('keeps several location strings in order and drops repeats', () => {
    const job = normalizePosting(posting(['New York, NY', 'Remote (US)', 'New York, NY']));
    expect(job.locationsText).toBe('New York, NY, USA; Remote in USA');
    expect(job.locationCount).toBe(2);
  });
});

/** [text in a posting, min, max, currency, period, yearly USD min, yearly USD max] (null: not a salary) */
const PAY: Array<[string, number | null, number | null, string, string, number | null, number | null] | [string, null]> = [
  ['The estimated salary range for this position is estimated to be $135,000 - $200,000/year.', 135000, 200000, 'USD', 'year', 135000, 200000],
  ['Salary Range: $110K–$160K, depending on experience and location', 110000, 160000, 'USD', 'year', 110000, 160000],
  ['$110K–$160K, depending on experience and location', 110000, 160000, 'USD', 'year', 110000, 160000],
  ['$100-130/hr', 100, 130, 'USD', 'hour', 208000, 270400],
  ['Zone A: $115,400 - $173,000 USD gross; Zone B: $130,400 - $195,600 USD gross', 115400, 173000, 'USD', 'year', 115400, 173000],
  ['$211.4K – $290.6K • Offers Equity', 211400, 290600, 'USD', 'year', 211400, 290600],
  ['Salary: £45,000 – £55,000 per year', 45000, 55000, 'GBP', 'year', 57150, 69850],
  ['Pay: €60.000 - €75.000', 60000, 75000, 'EUR', 'year', 64800, 81000],
  ['Compensation: CA$90,000 - CA$110,000', 90000, 110000, 'CAD', 'year', 65700, 80300],
  ['Salary: $90k CAD', 90000, 90000, 'CAD', 'year', 65700, 65700],
  ['CTC: ₹12-15 LPA', 1200000, 1500000, 'INR', 'year', 14400, 18000],
  ['Base salary from $120k+', 120000, null, 'USD', 'year', 120000, null],
  ['Salary up to $150,000', null, 150000, 'USD', 'year', null, 150000],
  ['Hourly rate: $60/hr', 60, 60, 'USD', 'hour', 124800, 124800],
  ['Pay: $25 - $30 per hour', 25, 30, 'USD', 'hour', 52000, 62400],
  ['Salary: $5,000/month', 5000, 5000, 'USD', 'month', 60000, 60000],
  ['Weekly pay: $1,200 per week', 1200, 1200, 'USD', 'week', 62400, 62400],
  ['Salary: $95,000', 95000, 95000, 'USD', 'year', 95000, 95000],
  ['Base pay range: $170,000-$230,000 USD', 170000, 230000, 'USD', 'year', 170000, 230000],
  ['The pay range for this role is: 140,000 - 180,000 USD per year (Remote)', 140000, 180000, 'USD', 'year', 140000, 180000],
  ['Compensation: $210K - $250K + equity', 210000, 250000, 'USD', 'year', 210000, 250000],
  ['$45 - 55/hour for contractors', 45, 55, 'USD', 'hour', 93600, 114400],
  ['Competitive salary and benefits', null],
  ['We match your 401k contributions', null],
  ['5+ years of experience with Python', null],
  ['Work from the office 2-3 days a week', null],
  ['USD $0.00 - USD $0.00 /Yr.', null],
  ['We raised $40M - $60M from top investors', null],
  ['Our customers range from $1M - $5M in revenue', null],
  ['Founded in 2015 - 2024 was our best year', null],
];

describe(`pay (${PAY.length} salary texts)`, () => {
  it.each(PAY)('%s', (text, ...expected) => {
    const found = salaryFromText(text);
    if (expected[0] === null && expected.length === 1) {
      expect(found).toBeNull();
      return;
    }
    const [min, max, currency, period, usdMin, usdMax] = expected as [number | null, number | null, string, string, number | null, number | null];
    expect(found).toMatchObject({ min, max, currency, period });
    expect(normalizeSalary(found, 'US')).toMatchObject({ min, max, currency, period, annualUsdMin: usdMin, annualUsdMax: usdMax });
  });

  it('defaults a bare range to the place\'s currency and keeps a stated text without amounts', () => {
    expect(normalizeSalary({ min: 50000, max: 60000, currency: null, period: 'year' }, 'GB')).toMatchObject({ currency: 'GBP', annualUsdMin: 63500 });
    expect(normalizeSalary({ min: null, max: null, currency: null, period: null, raw: 'Competitive' }, 'US')).toMatchObject({
      min: null,
      max: null,
      raw: 'Competitive',
      annualUsdMin: null,
    });
    expect(normalizeSalary({ min: 0, max: 0, currency: 'USD', period: 'year' }, 'US')).toBeNull();
  });
});
