import { linkKey, parseFlexibleDate, tidyText } from '@tailorit/shared';
import { sha256 } from './normalize';
import { IngestError, type RawPosting } from './types';

// Jobs from a spreadsheet or a JSON file (Admin > Import jobs): parse, guess which column is which (free_tailor's
// sheet headers included: Date, NO(DATE), Company, Job Title, Job Link, Job Description), and read each row as a posting.

export const IMPORT_FORMATS = ['csv', 'json'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_FIELDS = [
  'title',
  'company',
  'url',
  'description',
  'location',
  'postedAt',
  'salary',
  'employmentType',
  'workArrangement',
  'department',
  'id',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Record<ImportField, string | null>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  title: 'Job title',
  company: 'Company',
  url: 'Job link',
  description: 'Job description',
  location: 'Location',
  postedAt: 'Posted date',
  salary: 'Salary',
  employmentType: 'Job type',
  workArrangement: 'Work arrangement',
  department: 'Department',
  id: 'Job id',
};

/** Fields a row must have to become a job. */
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ['title', 'company', 'url'];

/** Header spellings per field, folded (lower case, letters and digits only), best first. */
const HEADER_GUESSES: Record<ImportField, readonly string[]> = {
  title: ['jobtitle', 'title', 'position', 'positiontitle', 'role', 'roletitle', 'jobname', 'job', 'name'],
  company: ['company', 'companyname', 'employer', 'organization', 'organisation', 'org', 'hiringcompany'],
  url: ['joblink', 'link', 'url', 'joburl', 'applyurl', 'applylink', 'applicationurl', 'applicationlink', 'postingurl', 'postinglink', 'href', 'hostedurl', 'absoluteurl'],
  description: ['jobdescription', 'description', 'jd', 'details', 'jobdetails', 'descriptionhtml', 'content', 'body', 'summary', 'descriptionplain'],
  location: ['location', 'locations', 'joblocation', 'city', 'office', 'place'],
  postedAt: ['date', 'posted', 'postedat', 'postedon', 'dateposted', 'postdate', 'postingdate', 'created', 'createdat', 'publishedat', 'published'],
  salary: ['salary', 'salaryrange', 'compensation', 'pay', 'payrange', 'wage', 'rate'],
  employmentType: ['employmenttype', 'jobtype', 'type', 'commitment', 'timetype', 'contracttype'],
  workArrangement: ['workarrangement', 'workplacetype', 'workplace', 'remote', 'worktype', 'locationtype', 'arrangement', 'workmodel'],
  department: ['department', 'team', 'function', 'category'],
  id: ['id', 'jobid', 'reqid', 'requisitionid', 'requisition', 'externalid', 'postingid'],
};

const fold = (header: string) => header.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Which column holds which field, by header name; each column is used once. NO(DATE) is the sheet's row counter. */
export function guessMapping(columns: readonly string[]): ImportMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, null])) as ImportMapping;
  const used = new Set<string>();
  const folded = columns.map((column) => ({ column, key: fold(column) })).filter(({ key }) => key && key !== 'nodate');
  for (const field of IMPORT_FIELDS) {
    for (const guess of HEADER_GUESSES[field]) {
      const hit = folded.find(({ column, key }) => key === guess && !used.has(column));
      if (hit) {
        mapping[field] = hit.column;
        used.add(hit.column);
        break;
      }
    }
  }
  return mapping;
}

/** The format a file is in, by its name, else by its first character. */
export function detectFormat(fileName: string, text: string): ImportFormat {
  if (/\.json$/i.test(fileName)) return 'json';
  if (/\.(?:csv|tsv|txt)$/i.test(fileName)) return 'csv';
  return /^\s*[[{]/.test(text) ? 'json' : 'csv';
}

/** The delimiter of a CSV text: the one of , ; tab that splits its first line most. */
function delimiterOf(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 CSV: quoted fields with "" escapes and line breaks, CRLF or LF, a BOM ignored. Blank lines dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\ufeff/, '');
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

export interface Table {
  format: ImportFormat;
  columns: string[];
  rows: Array<Record<string, string>>;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // {"name": "Acme"} / {"location": "Paris"}: the one text a nested object usually carries.
    for (const key of ['name', 'text', 'title', 'location', 'value', 'url']) {
      if (typeof record[key] === 'string') return record[key];
    }
    return JSON.stringify(value);
  }
  return '';
}

/** A CSV file as a table: the first row is the header; repeated or blank headers get a number. */
export function tableFromCsv(text: string): Table {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new IngestError('The file is empty.');
  const header = rows[0]!.map((cell, index) => tidyText(cell) || `Column ${index + 1}`);
  const columns = header.map((name, index) => (header.indexOf(name) === index ? name : `${name} (${index + 1})`));
  return {
    format: 'csv',
    columns,
    rows: rows.slice(1).map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']))),
  };
}

/** A JSON file as a table: an array of objects, or an object holding one under jobs / items / data / results. */
export function tableFromJson(text: string): Table {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\ufeff/, ''));
  } catch {
    throw new IngestError('The file is not valid JSON.');
  }
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    data = [record.jobs, record.items, record.data, record.results, record.postings].find(Array.isArray) ?? data;
  }
  if (!Array.isArray(data)) throw new IngestError('The JSON file must hold a list of jobs (an array of objects).');
  const objects = data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (objects.length === 0) throw new IngestError('The JSON file holds no job objects.');
  const columns: string[] = [];
  for (const object of objects) for (const key of Object.keys(object)) if (!columns.includes(key)) columns.push(key);
  return {
    format: 'json',
    columns,
    rows: objects.map((object) => Object.fromEntries(columns.map((column) => [column, cellText(object[column])]))),
  };
}

export function readTable(fileName: string, text: string): Table {
  return detectFormat(fileName, text) === 'json' ? tableFromJson(text) : tableFromCsv(text);
}

/** A mapping with every named column checked against the table; unknown columns become null. */
export function cleanMapping(mapping: Partial<Record<ImportField, string | null>>, columns: readonly string[]): ImportMapping {
  const out = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, null])) as ImportMapping;
  for (const field of IMPORT_FIELDS) {
    const column = mapping[field];
    if (typeof column === 'string' && columns.includes(column)) out[field] = column;
  }
  return out;
}

function cell(row: Record<string, string>, mapping: ImportMapping, field: ImportField): string {
  const column = mapping[field];
  return column ? (row[column] ?? '').trim() : '';
}

/** A row's posted date: a calendar date at midnight UTC, or an ISO timestamp as given. */
function postedAtOf(value: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const day = parseFlexibleDate(value);
  return day ? `${day}T00:00:00.000Z` : null;
}

/** A stable id for a row without one: its link, else a hash of company, title and description. */
export function rowIdOf(company: string, title: string, url: string, description: string): string {
  return linkKey(url) ?? `row-${sha256(`${company}\n${title}\n${description}`).slice(0, 32)}`;
}

/** One row as a posting, or an error sentence naming the row (1-based, counting the header for CSV). */
export function rowToPosting(
  row: Record<string, string>,
  mapping: ImportMapping,
  rowNumber: number,
): { posting: RawPosting } | { error: string } {
  const title = cell(row, mapping, 'title');
  const company = cell(row, mapping, 'company');
  const url = cell(row, mapping, 'url');
  if (!title) return { error: `Row ${rowNumber} has no job title.` };
  if (!company) return { error: `Row ${rowNumber} ("${title}") has no company.` };
  if (!url) return { error: `Row ${rowNumber} ("${title}") has no job link.` };
  const description = cell(row, mapping, 'description');
  const isHtml = /<\/?(?:p|div|ul|ol|li|br|h[1-6]|strong|b)\b/i.test(description);
  const location = cell(row, mapping, 'location');
  const sourceJobId = cell(row, mapping, 'id') || rowIdOf(company, title, url, description);
  // A "Remote" column of yes/no answers says the arrangement without naming it.
  const arrangement = cell(row, mapping, 'workArrangement');
  const yesNoRemote = mapping.workArrangement !== null && fold(mapping.workArrangement) === 'remote';
  const remoteAnswer = yesNoRemote && /^(?:yes|y|true|1)$/i.test(arrangement);
  return {
    posting: {
      sourceJobId,
      title,
      company: { name: company },
      descriptionHtml: isHtml ? description : null,
      descriptionText: isHtml ? null : description,
      url,
      locations: location ? [location] : [],
      salaryText: cell(row, mapping, 'salary') || null,
      employmentText: cell(row, mapping, 'employmentType') || null,
      workArrangement: remoteAnswer ? 'remote' : null,
      arrangementText: yesNoRemote ? null : arrangement || null,
      department: cell(row, mapping, 'department') || null,
      postedAt: postedAtOf(cell(row, mapping, 'postedAt')),
    },
  };
}
