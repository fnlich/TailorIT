import { describe, expect, it } from 'vitest';
import {
  findDateRanges,
  isEducationLine,
  monthIndex,
  monthsOf,
  parseResumeDate,
  rangesOfEntries,
  rangesOfText,
  resumeHeadingOf,
  yearsOf,
} from './years';

const NOW = new Date('2026-10-22T12:00:00Z');
const OCT_2026 = monthIndex(2026, 10);

describe('parseResumeDate', () => {
  it.each([
    ['03/2019', { year: 2019, month: 3 }],
    ['3/2019', { year: 2019, month: 3 }],
    ['03-2019', { year: 2019, month: 3 }],
    ['03.2019', { year: 2019, month: 3 }],
    ['2019-03', { year: 2019, month: 3 }],
    ['2019/03', { year: 2019, month: 3 }],
    ['March 2019', { year: 2019, month: 3 }],
    ['Mar 2019', { year: 2019, month: 3 }],
    ['Mar. 2019', { year: 2019, month: 3 }],
    ['Sept 2019', { year: 2019, month: 9 }],
    ["Mar '19", { year: 2019, month: 3 }],
    ['Summer 2021', { year: 2021, month: 7 }],
    ['03/19', { year: 2019, month: 3 }],
    ['03/15/2019', { year: 2019, month: 3 }],
    ['Jan 15, 2019', { year: 2019, month: 1 }],
    ['2019', { year: 2019, month: null }],
    ['Present', 'present'],
    ['current', 'present'],
    ['Ongoing', 'present'],
    ['to date', 'present'],
    ['13/2019', null],
    ['1890', null],
    ['Q3', null],
    ['', null],
  ])('%s', (token, expected) => {
    expect(parseResumeDate(token)).toEqual(expected);
  });
});

describe('date ranges in text', () => {
  it('reads "2019-2021" as a range, not as YYYY-MM', () => {
    expect(findDateRanges('Acme 2019-2021').map((found) => found.range)).toEqual([[monthIndex(2019, 7), monthIndex(2021, 6)]]);
    expect(findDateRanges('Released 2019-03 notes')).toEqual([]);
    expect(findDateRanges('12019 - 2021 and 2019 - 20210')).toEqual([]);
  });

  it('allows line breaks around the separator and reads end words', () => {
    expect(findDateRanges('Jan 2020 –\nPresent').map((found) => found.range)).toEqual([[monthIndex(2020, 1), null]]);
    expect(findDateRanges('03/2016 - 12/2019; 2015 to 2016; Summer 2021 through Fall 2021').map((found) => found.range)).toEqual([
      [monthIndex(2016, 3), monthIndex(2019, 12)],
      [monthIndex(2015, 7), monthIndex(2016, 6)],
      [monthIndex(2021, 7), monthIndex(2021, 10)],
    ]);
  });

  it('reads a bare year as mid-year, and one year at both ends as six months', () => {
    expect(findDateRanges('2019 – 2019').map((found) => found.range)).toEqual([[monthIndex(2019, 4), monthIndex(2019, 9)]]);
    expect(findDateRanges('2019 – Mar 2019').map((found) => found.range)).toEqual([[monthIndex(2019, 1), monthIndex(2019, 3)]]);
    expect(findDateRanges('Mar 2019 – 2019').map((found) => found.range)).toEqual([[monthIndex(2019, 3), monthIndex(2019, 12)]]);
  });

  it('skips a range that ends before it starts', () => {
    expect(findDateRanges('2021 - 2019')).toEqual([]);
  });
});

describe('rangesOfText', () => {
  const resume = [
    'Jane Doe',
    'Summary',
    'Engineer since 2012 - 2014 at college clubs',
    'Professional Experience',
    'Senior Engineer | Northwind | Jan 2020 – Present',
    'Engineer, Acme, 03/2016 - 12/2019',
    'B.S. Computer Science, 2012 – 2016',
    'Volunteer Experience',
    'Mentor, Code Club, 2018 - 2020',
    'Education',
    'Cascadia Institute of Technology, 2012 - 2016',
  ].join('\n');

  it('reads only the Experience section, bounded by the next known heading', () => {
    expect(rangesOfText(resume)).toEqual([
      [monthIndex(2020, 1), null],
      [monthIndex(2016, 3), monthIndex(2019, 12)],
    ]);
  });

  it.each(['Leadership Experience', 'Research Experience', 'Teaching Experience', 'Activities', 'Honors', 'Summary', 'Technical Skills', 'Key Strengths'])(
    '%s ends the Experience section',
    (heading) => {
      const text = ['Experience', 'Engineer, Acme, 2016 - 2019', heading, 'Something, 2010 - 2012'].join('\n');
      expect(rangesOfText(text)).toEqual([[monthIndex(2016, 7), monthIndex(2019, 6)]]);
    },
  );

  it('always leaves out education, even inside Experience (two-column PDFs mix lines)', () => {
    const text = ['Work Experience', 'Engineer, Acme, 2016 - 2019', 'University of Washington', '2012 – 2016', 'Analyst, Beta, 2014 - 2015'].join('\n');
    // 2012-2016 sits next to a university line; Analyst 2014-2015 sits next to the 2012-2016 line, which is fine.
    expect(rangesOfText(text)).toEqual([
      [monthIndex(2016, 7), monthIndex(2019, 6)],
      [monthIndex(2014, 7), monthIndex(2015, 6)],
    ]);
  });

  it('reads every range when there is no Experience heading, education left out', () => {
    const text = ['Engineer, Acme, 2016 - 2019', '', 'BA in Economics', '2010 - 2014', '', 'Bootcamp graduate 2015 - 2015'].join('\n');
    expect(rangesOfText(text)).toEqual([[monthIndex(2016, 7), monthIndex(2019, 6)]]);
  });

  it('keeps a role at a university or school as work', () => {
    const text = ['Experience', 'Research Assistant, Stanford University, 2018 - 2020', 'Teacher, Lincoln High School, 2015 - 2018'].join('\n');
    expect(rangesOfText(text)).toHaveLength(2);
  });

  it('stores ranges as written: a future range is kept, and only counts once it has started', () => {
    const ranges = rangesOfText('Experience\nFounder, NextCo, 2030 - 2032');
    expect(ranges).toEqual([[monthIndex(2030, 7), monthIndex(2032, 6)]]);
    expect(monthsOf(ranges, NOW)).toBe(0);
    expect(monthsOf(ranges, new Date('2031-07-15T00:00:00Z'))).toBe(13);
  });
});

describe('isEducationLine', () => {
  it.each([
    ['B.S. Computer Science', true],
    ['BS in Physics', true],
    ['BA, Economics', true],
    ['B.A. History', true],
    ['M.A. Linguistics', true],
    ['MSc Data Science', true],
    ["Master's degree", true],
    ['PhD, Chemistry', true],
    ['GPA 3.9', true],
    ['Class of 2016', true],
    ['Coding Bootcamp', true],
    ['Cascadia Institute of Technology', true],
    ['General Assembly Academy', true],
    ['Scrum Master, Acme', false],
    ['Associate Product Manager', false],
    ['Research Assistant, Stanford University', false],
    ['Boston, MA', false],
    ['MS SQL Server administration', false],
  ])('%s -> %s', (line, expected) => {
    expect(isEducationLine(line)).toBe(expected);
  });
});

describe('resumeHeadingOf', () => {
  it.each([
    ['PROFESSIONAL EXPERIENCE', 'experience'],
    ['Work History:', 'experience'],
    ['E X P E R I E N C E', 'experience'],
    ['Volunteer Experience', 'other'],
    ['Education & Certifications', 'other'],
    ['Technical Skills', 'other'],
    ['Senior Engineer at Acme', null],
    ['Led the experience team', null],
  ])('%s', (line, expected) => {
    expect(resumeHeadingOf(line)).toBe(expected);
  });
});

describe('rangesOfEntries', () => {
  it("reads a built resume's roles; an empty end on the most recent role is Present", () => {
    expect(
      rangesOfEntries([
        { startDate: '02/2021', endDate: '' },
        { startDate: '2018', endDate: '01/2021' },
        { startDate: '06/2015', endDate: '' },
        { startDate: '', endDate: '2014' },
        { startDate: 'Feb 2012 (contract)', endDate: 'Present' },
      ]),
    ).toEqual([
      [monthIndex(2021, 2), null],
      [monthIndex(2018, 7), monthIndex(2021, 1)],
      [monthIndex(2015, 6), monthIndex(2015, 6)],
      [monthIndex(2012, 2), null],
    ]);
  });
});

describe('monthsOf', () => {
  it('merges overlapping and adjoining ranges, counting months inclusively', () => {
    expect(monthsOf([[monthIndex(2020, 1), monthIndex(2020, 12)]], NOW)).toBe(12);
    expect(
      monthsOf(
        [
          [monthIndex(2020, 1), monthIndex(2020, 12)],
          [monthIndex(2020, 6), monthIndex(2021, 3)],
          [monthIndex(2021, 4), monthIndex(2021, 6)],
        ],
        NOW,
      ),
    ).toBe(18);
  });

  it('counts Present up to this month, clamps later ends and skips future starts', () => {
    expect(monthsOf([[monthIndex(2026, 1), null]], NOW)).toBe(10);
    expect(monthsOf([[monthIndex(2026, 1), null]], new Date('2027-01-05T00:00:00Z'))).toBe(13);
    expect(monthsOf([[monthIndex(2026, 1), monthIndex(2030, 1)]], NOW)).toBe(OCT_2026 - monthIndex(2026, 1) + 1);
    expect(monthsOf([[monthIndex(2027, 1), null]], NOW)).toBe(0);
    expect(monthsOf([[monthIndex(1940, 1), monthIndex(1945, 1)]], NOW)).toBe(0);
  });
});

describe('yearsOf', () => {
  const dated = { experience: [[monthIndex(2016, 11), null]] as Array<[number, number | null]> };

  it("lets the editor's field win", () => {
    expect(yearsOf({ ...dated, yearsStated: 4, yearsStatedBasis: 'field' }, NOW)).toEqual({ years: 4, basis: 'field' });
  });

  it('takes the larger of the dates and a stated total, dates on a tie', () => {
    expect(yearsOf({ ...dated, yearsStated: null, yearsStatedBasis: null }, NOW)).toEqual({ years: 10, basis: 'dates' });
    expect(yearsOf({ ...dated, yearsStated: 12, yearsStatedBasis: 'stated' }, NOW)).toEqual({ years: 12, basis: 'stated' });
    expect(yearsOf({ ...dated, yearsStated: 10, yearsStatedBasis: 'stated' }, NOW)).toEqual({ years: 10, basis: 'dates' });
    expect(yearsOf({ experience: [], yearsStated: null, yearsStatedBasis: null }, NOW)).toEqual({ years: null, basis: null });
  });

  it('keeps counting a Present role as time passes', () => {
    const data = { experience: [[monthIndex(2025, 11), null]] as Array<[number, number | null]>, yearsStated: null, yearsStatedBasis: null };
    expect(yearsOf(data, NOW).years).toBe(1);
    expect(yearsOf(data, new Date('2027-11-01T00:00:00Z')).years).toBe(2.1);
  });
});
