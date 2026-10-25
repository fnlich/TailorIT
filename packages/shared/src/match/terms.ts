import { escapeRegExp } from '../format/text';

// How a keyword is found in text. One rule for the job match and the keyword extractor (free_tailor's `termPattern`,
// `config/conceptTools.ts`): a term counts only as a whole word or phrase, any run of spaces matches any other, and
// the match ignores case, except for terms of one or two characters ("Go", "R", "CI", "ML"), which must be spelled as
// written so they are not found inside ordinary prose ("go", "ml").

/** A letter or digit in any script: what ends a match on either side. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

export interface TermPatternOptions {
  /** A `g` pattern, for counting or scanning every match. */
  global?: boolean;
  /**
   * A `y` pattern: it matches only where `lastIndex` points, so a caller that knows where a term can start (the
   * prepared evidence of `match/evidence.ts`) tests just those places. The boundary checks read the text around it.
   */
  sticky?: boolean;
  /** Override the case rule (default: case-sensitive only for terms of 2 characters or fewer). */
  caseSensitive?: boolean;
}

/**
 * `term` as a pattern that finds it as a whole word or phrase.
 *
 * Letters and digits (of any script) on either side end a match; punctuation does not, so "CI/CD", "C++", "C#" and
 * "Node.js" match as written, and ".NET" is not found inside "ASP.NET" or "acme.net". Two refinements of free_tailor's
 * rule: a term ending in punctuation needs no boundary after it ("C++" is found in "C++17"), and a term ending in a
 * letter or digit is not found where "+" or "#" continues it ("C" is not found in "C++" or "C#"). Null for a blank
 * term.
 */
export function termPattern(term: string, options: TermPatternOptions | boolean = {}): RegExp | null {
  const settings = typeof options === 'boolean' ? { global: options } : options;
  const { global = false, sticky = false, caseSensitive } = settings;
  const normalized = term.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  const body = escapeRegExp(normalized).replace(/ /g, '\\s+');
  const trail = WORD_CHAR.test(normalized.charAt(normalized.length - 1)) ? '(?![\\p{L}\\p{N}+#])' : '';
  const sensitive = caseSensitive ?? normalized.length <= 2;
  const flags = `u${sensitive ? '' : 'i'}${global ? 'g' : ''}${sticky ? 'y' : ''}`;
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${trail}`, flags);
}

// Non-global patterns are stateless, so they can be cached and reused.
const PATTERN_CACHE = new Map<string, RegExp | null>();
const PATTERN_CACHE_MAX = 4000;

function cachedPattern(term: string): RegExp | null {
  let pattern = PATTERN_CACHE.get(term);
  if (pattern === undefined) {
    if (PATTERN_CACHE.size >= PATTERN_CACHE_MAX) PATTERN_CACHE.clear();
    pattern = termPattern(term);
    PATTERN_CACHE.set(term, pattern);
  }
  return pattern;
}

/** Whether `text` carries `term` as a whole word or phrase (see `termPattern`). */
export function containsTerm(text: string, term: string): boolean {
  return cachedPattern(term)?.test(text) ?? false;
}

/** How many times `text` carries `term`, and the index of the first (-1 for none). */
export function countTerm(text: string, term: string): { count: number; first: number } {
  const pattern = termPattern(term, { global: true });
  if (!pattern || !text) return { count: 0, first: -1 };
  let count = 0;
  let first = -1;
  for (const match of text.matchAll(pattern)) {
    if (first < 0) first = match.index ?? 0;
    count += 1;
  }
  return { count, first };
}

/**
 * Phrases whose words are not the technology they spell: "TS/SCI" is a clearance, not TypeScript; "American Express"
 * is a company; "go-to-market" is not Go. Masked out of a text before any term is looked for in it.
 */
export const FALSE_FRIEND_PHRASES: readonly string[] = [
  'TS/SCI',
  'TS-SCI',
  'TS SCI',
  'American Express',
  'go-to-market',
  'go to market',
  'Go-To-Market',
];

const FALSE_FRIEND_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(?:${FALSE_FRIEND_PHRASES.map((phrase) => escapeRegExp(phrase).replace(/[ -]/g, '[\\s-]')).join('|')})(?![A-Za-z0-9])`,
  'gi',
);

/** The text with every false-friend phrase blanked out (same length, so indexes stay put). */
export function maskFalseFriends(text: string): string {
  return text.replace(FALSE_FRIEND_PATTERN, (phrase) => ' '.repeat(phrase.length));
}

/**
 * Spellings of one thing, canonical first: TailorIT's closed list. Two spellings in one group are one keyword for the
 * extractor and the match ("K8s" on a resume satisfies "Kubernetes" in a posting). Words that are also everyday
 * English ("node", "rails") are deliberately left out, because the match reads terms over two characters in any case.
 */
export const TERM_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ['Kubernetes', 'K8s'],
  ['JavaScript', 'JS', 'ECMAScript', 'ES6'],
  ['TypeScript', 'TS'],
  ['PostgreSQL', 'Postgres'],
  ['Google Cloud', 'GCP', 'Google Cloud Platform'],
  ['AWS', 'Amazon Web Services'],
  ['Azure', 'Microsoft Azure'],
  ['CI/CD', 'CICD', 'CI-CD'],
  ['Machine Learning', 'ML'],
  ['Artificial Intelligence', 'AI'],
  ['Large Language Models', 'LLMs', 'LLM'],
  ['Natural Language Processing', 'NLP'],
  ['Go', 'Golang'],
  ['Node.js', 'NodeJS', 'Node JS'],
  ['React', 'React.js', 'ReactJS'],
  ['Vue.js', 'Vue', 'VueJS'],
  ['Next.js', 'NextJS'],
  ['C#', 'CSharp', 'C Sharp'],
  ['.NET', 'dotnet'],
  ['C++', 'CPP'],
  ['HTML', 'HTML5'],
  ['CSS', 'CSS3'],
  ['Python', 'Python3'],
  ['MongoDB', 'Mongo'],
  ['Amazon S3', 'S3', 'AWS S3'],
  ['Amazon EC2', 'EC2'],
  ['Apache Kafka', 'Kafka'],
  ['Apache Spark', 'Spark'],
  ['Apache Airflow', 'Airflow'],
  ['scikit-learn', 'sklearn'],
  ['Microsoft SQL Server', 'SQL Server', 'MSSQL'],
  ['Infrastructure as Code', 'IaC'],
  ['Site Reliability Engineering', 'SRE'],
  ['User Experience', 'UX'],
  ['Quality Assurance', 'QA'],
  ['Test-Driven Development', 'TDD'],
  ['Object-Oriented Programming', 'OOP'],
  ['Single Sign-On', 'SSO'],
  ['Role-Based Access Control', 'RBAC'],
  ['Search Engine Optimization', 'SEO'],
  ['Customer Relationship Management', 'CRM'],
  ['Business Intelligence', 'BI'],
  ['Google Kubernetes Engine', 'GKE'],
  ['Amazon EKS', 'EKS'],
  ['Amazon DynamoDB', 'DynamoDB', 'AWS DynamoDB'],
  ['Elasticsearch', 'Elastic Search'],
  // The skill library's aliases (apps/api/static/skills/skills.json): each alias is listed with its entry here, so
  // it is the same keyword. Spellings of one name:
  ['ArgoCD', 'Argo CD'],
  ['Auto Scaling', 'Auto-scaling'],
  ['Actix Web', 'Actix-web'],
  ['Git Flow', 'GitFlow'],
  ['Micro Frontends', 'Micro-frontends'],
  ['Solid.js', 'SolidJS'],
  ['API gateway', 'API Gateways'],
  ['API integration', 'API integrations'],
  ['Secure API', 'Secure APIs'],
  // A vendor's product and its short name, where the short name is not an everyday word or another product's:
  ['AWS CloudFormation', 'CloudFormation'],
  ['Amazon CloudFront', 'CloudFront'],
  ['Amazon ECS', 'AWS ECS', 'ECS'],
  ['Amazon RDS', 'AWS RDS', 'RDS'],
  ['Amazon Route 53', 'Route53'],
  ['AWS CloudTrail', 'CloudTrail'],
  ['Amazon ElastiCache', 'ElastiCache'],
  ['Amazon Kinesis', 'Kinesis'],
  ['Amazon SQS', 'SQS'],
  ['Amazon SNS', 'SNS'],
  ['Apache Avro', 'Avro'],
  ['Apache Flink', 'Flink'],
];

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Whitespace collapsed; case kept for terms of two characters or fewer, else lower case (`termPattern`'s rule). */
export function matchKey(term: string): string {
  const collapsed = collapse(term);
  return collapsed.length <= 2 ? collapsed : collapsed.toLowerCase();
}

const GROUP_BY_KEY = new Map<string, number>();
const GROUP_BY_LOWER = new Map<string, number>();
TERM_SYNONYMS.forEach((group, index) => {
  for (const spelling of group) {
    GROUP_BY_KEY.set(matchKey(spelling), index);
    GROUP_BY_LOWER.set(collapse(spelling).toLowerCase(), index);
  }
});

function groupIndexOf(term: string): number | undefined {
  return GROUP_BY_KEY.get(matchKey(term)) ?? GROUP_BY_LOWER.get(collapse(term).toLowerCase());
}

/** The key two spellings of one thing share: their synonym group's canonical key, else `matchKey`. */
export function synonymKey(term: string): string {
  const index = groupIndexOf(term);
  const group = index === undefined ? undefined : TERM_SYNONYMS[index];
  return group ? matchKey(group[0]!) : matchKey(term);
}

/** Every spelling of `term`'s group (canonical first), or just the term when it has no group. */
export function synonymsOf(term: string): string[] {
  const index = groupIndexOf(term);
  const group = index === undefined ? undefined : TERM_SYNONYMS[index];
  const cleaned = collapse(term);
  if (!group) return cleaned ? [cleaned] : [];
  return group.includes(cleaned) ? [...group] : [...group, cleaned];
}

/** The distinct `[A-Za-z0-9]+` runs of a text, lower-cased: what a whole-word match of any term must contain. */
export function alnumRuns(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z0-9]+/g) ?? []).map((run) => run.toLowerCase()));
}

/** The first `[A-Za-z0-9]+` run of a term, lower-cased ('' for a term with none). */
export function firstRun(term: string): string {
  return /[A-Za-z0-9]+/.exec(term)?.[0]?.toLowerCase() ?? '';
}
