import { describe, expect, it } from 'vitest';
import { countryDisplayName, currencyForCountry } from './geo';
import { formatLocation, hasRemoteLocation, parseLocations, type ParsedLocation } from './locations';

type Place = Omit<ParsedLocation, 'raw'>;
const place = (city: string | null, region: string | null, countryCode: string | null, isRemote = false): Place => ({
  city,
  region,
  countryCode,
  isRemote,
});
const strip = (locations: ParsedLocation[]): Place[] => locations.map(({ raw: _raw, ...rest }) => rest);

describe('parseLocations: single places', () => {
  it.each([
    ['San Francisco, CA', place('San Francisco', 'CA', 'US')],
    ['Fremont, CA, USA', place('Fremont', 'CA', 'US')],
    ['Austin, Texas', place('Austin', 'TX', 'US')],
    ['Austin, TX, US', place('Austin', 'TX', 'US')],
    ['New York, NY', place('New York', 'NY', 'US')],
    ['New York, New York, United States', place('New York', 'NY', 'US')],
    ['New York', place('New York', 'NY', 'US')],
    ['NYC', place('New York', 'NY', 'US')],
    ['Albany, New York', place('Albany', 'NY', 'US')],
    ['Washington, DC', place('Washington', 'DC', 'US')],
    ['Washington D.C.', place('Washington', 'DC', 'US')],
    ['Portland, OR', place('Portland', 'OR', 'US')],
    ['Paris, TX', place('Paris', 'TX', 'US')],
    ['Dublin, CA', place('Dublin', 'CA', 'US')],
    ['California', place(null, 'CA', 'US')],
    ['Toronto, ON, Canada', place('Toronto', 'ON', 'CA')],
    ['Toronto, ON, CA', place('Toronto', 'ON', 'CA')],
    ['Vancouver, BC', place('Vancouver', 'BC', 'CA')],
    ['Vancouver, WA', place('Vancouver', 'WA', 'US')],
    ['Montréal, Québec', place('Montreal', 'QC', 'CA')],
    ['London, ON', place('London', 'ON', 'CA')],
    ['London, UK', place('London', null, 'GB')],
    ['London', place('London', null, 'GB')],
    ['Berlin, Germany', place('Berlin', null, 'DE')],
    ['Bengaluru, Karnataka, India', place('Bengaluru', 'Karnataka', 'IN')],
    ['Bangalore, IN', place('Bengaluru', null, 'IN')],
    ['Sydney, NSW, Australia', place('Sydney', 'NSW', 'AU')],
    ['Singapore', place('Singapore', null, 'SG')],
    ['United States', place(null, null, 'US')],
    ['USA', place(null, null, 'US')],
    ['Springfield', place('Springfield', null, null)],
    ['san francisco, ca', place('San Francisco', 'CA', 'US')],
  ])('%s', (text, expected) => {
    expect(strip(parseLocations(text))).toEqual([expected]);
  });
});

describe('parseLocations: remote phrasing', () => {
  it.each([
    ['Remote', place(null, null, null, true)],
    ['Remote - US', place(null, null, 'US', true)],
    ['Remote in USA', place(null, null, 'US', true)],
    ['US Remote', place(null, null, 'US', true)],
    ['Remote (Canada)', place(null, null, 'CA', true)],
    ['Remote-US', place(null, null, 'US', true)],
    ['Remote (US only)', place(null, null, 'US', true)],
    ['Fully Remote', place(null, null, null, true)],
    ['Work from home', place(null, null, null, true)],
    ['Anywhere', place(null, null, null, true)],
    ['Remote - EMEA', place(null, null, null, true)],
    ['Remote, California', place(null, 'CA', 'US', true)],
  ])('%s', (text, expected) => {
    expect(strip(parseLocations(text))).toEqual([expected]);
  });
});

describe('parseLocations: several places', () => {
  it('splits on semicolons, pipes, " or " and " / "', () => {
    expect(strip(parseLocations('New York, NY; San Francisco, CA | Remote - US'))).toEqual([
      place('New York', 'NY', 'US'),
      place('San Francisco', 'CA', 'US'),
      place(null, null, 'US', true),
    ]);
    expect(strip(parseLocations('Seattle, WA / Portland, OR or Remote'))).toEqual([
      place('Seattle', 'WA', 'US'),
      place('Portland', 'OR', 'US'),
      place(null, null, null, true),
    ]);
  });

  it('splits complete places that only commas separate', () => {
    expect(strip(parseLocations('San Francisco, CA, New York, NY'))).toEqual([
      place('San Francisco', 'CA', 'US'),
      place('New York', 'NY', 'US'),
    ]);
    expect(parseLocations('San Francisco, CA, New York, NY').map((location) => location.raw)).toEqual([
      'San Francisco, CA',
      'New York, NY',
    ]);
  });

  it('carries remote onto a country after a remote place', () => {
    expect(strip(parseLocations('Remote, US or Canada'))).toEqual([
      place(null, null, 'US', true),
      place(null, null, 'CA', true),
    ]);
  });

  it.each([
    ['Remote in the US', [place(null, null, 'US', true)]],
    ['Remote within the United States', [place(null, null, 'US', true)]],
    ['Remote - US/Canada', [place(null, null, 'US', true), place(null, null, 'CA', true)]],
    ['Remote (US & Canada)', [place(null, null, 'US', true), place(null, null, 'CA', true)]],
    ['US and Canada', [place(null, null, 'US'), place(null, null, 'CA')]],
    ['Bengaluru, Karnataka', [place('Bengaluru', 'Karnataka', 'IN')]],
    ['Sydney, NSW', [place('Sydney', 'NSW', 'AU')]],
    ['Munich, Bavaria', [place('Munich', 'Bavaria', 'DE')]],
    ['Berlin, Munich', [place('Berlin', null, 'DE'), place('Munich', null, 'DE')]],
    ['London, England, United Kingdom', [place('London', null, 'GB')]],
    ['France, Germany', [place(null, null, 'FR'), place(null, null, 'DE')]],
    ['Remote - IN', [place(null, 'IN', 'US', true)]],
    ['Based in London', [place('London', null, 'GB')]],
    ['Remote (EST)', [place(null, null, null, true)]],
    ['Remote - US (Eastern Time Zone)', [place(null, null, 'US', true)]],
    ['US-CA-San Francisco', [place('San Francisco', 'CA', 'US')]],
    ['Remote OR Hybrid', [place(null, null, null, true)]],
    ['Anywhere in the world', [place(null, null, null, true)]],
    ['Utrecht, NL', [place('Utrecht', null, 'NL')]],
    ["St. John's, NL", [place("St. John's", 'NL', 'CA')]],
    ['NY/SF', [place(null, 'NY', 'US'), place('San Francisco', 'CA', 'US')]],
    ['Hybrid (Seattle, WA)', [place('Seattle', 'WA', 'US')]],
    ['Remote-Friendly (Travel Required), United States', [place(null, null, 'US', true)]],
    ['constructor', [place('constructor', null, null)]],
  ])('reads %s', (text, expected) => {
    expect(strip(parseLocations(text))).toEqual(expected);
  });

  it('drops arrangement words and keeps the place', () => {
    expect(strip(parseLocations('Hybrid - NYC'))).toEqual([place('New York', 'NY', 'US')]);
    expect(strip(parseLocations('New York, NY (Hybrid)'))).toEqual([place('New York', 'NY', 'US')]);
    expect(strip(parseLocations('Onsite in Atlanta, GA'))).toEqual([place('Atlanta', 'GA', 'US')]);
  });

  it('reads lists, removes repeats and keeps the raw text', () => {
    const locations = parseLocations(['Boston, MA', 'Boston, MA', 'Remote']);
    expect(locations.map((location) => location.raw)).toEqual(['Boston, MA', 'Remote']);
    expect(hasRemoteLocation(locations)).toBe(true);
  });

  it('keeps "no particular place" text as raw only', () => {
    expect(parseLocations('Multiple Locations')).toEqual([
      { raw: 'Multiple Locations', city: null, region: null, countryCode: null, isRemote: false },
    ]);
    expect(parseLocations('')).toEqual([]);
    expect(parseLocations(null)).toEqual([]);
  });
});

describe('formatLocation', () => {
  it.each([
    ['Fremont, CA', 'Fremont, CA, USA'],
    ['London', 'London, UK'],
    ['Toronto, ON', 'Toronto, ON, Canada'],
    ['Remote - US', 'Remote in USA'],
    ['Remote', 'Remote'],
    ['Singapore', 'Singapore'],
    ['Multiple Locations', 'Multiple Locations'],
  ])('%s prints as %s', (text, expected) => {
    expect(formatLocation(parseLocations(text)[0]!)).toBe(expected);
  });

  it('names countries and their currencies', () => {
    expect(countryDisplayName('US')).toBe('USA');
    expect(countryDisplayName('DE')).toBe('Germany');
    expect(currencyForCountry('GB')).toBe('GBP');
    expect(currencyForCountry('ZZ')).toBeNull();
  });
});
