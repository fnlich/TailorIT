// The fake model's `job_analysis` answer, read off the posting in the prompt, so the dev server shows each job its own
// summary and keywords. Plain Node ESM, no dependencies (see README.md for the ctx shape).
//
// - Summary: the posting's own bullet lines under its Requirements / Responsibilities / Nice-to-have headings.
// - Keywords: terms of the small list below that the posting names, spelled as the posting spells them; "high" when
//   the requirements or the title name them, "low" otherwise.
// - Soft skills: the phrases of the small list below that the requirement, duty and nice-to-have lines name, spelled
//   as the posting spells them. Terms: the certifications and industries of the lists below the posting names.
// - Facts: experience levels from the title (else the years asked for), the fewest years asked for, the years the
//   requirements ask for in general (the first "N years of ... experience" line); the rest null, so the job's own
//   facts stand.
// - Like a real model now and then, it also slips in things the posting never says: a requirement, a keyword, a pay
//   figure, one keyword twice, and a soft skill (Diplomacy, a real entry of the soft-skill list). TailorIT's grounding
//   (apps/api/src/features/job-analysis/ai.ts) must drop them.

/** [term, synonyms, case-sensitive], grouped by kind; within a priority, keywords are listed in this order. */
const TERMS = [
  // Languages
  ['Go', ['Golang'], true],
  ['Python', []],
  ['Java', []],
  ['JavaScript', ['JS']],
  ['TypeScript', ['TS']],
  ['Ruby', []],
  ['Rust', [], true],
  ['C++', []],
  ['C#', []],
  ['Kotlin', []],
  ['Swift', [], true],
  ['Scala', []],
  ['PHP', []],
  ['SQL', []],
  ['Bash', []],
  // Frameworks and runtimes
  ['React', ['React.js']],
  ['Next.js', []],
  ['Vue.js', ['Vue']],
  ['Angular', []],
  ['Node.js', ['NodeJS']],
  ['Django', []],
  ['Spring Boot', []],
  ['.NET', []],
  ['GraphQL', []],
  ['Jetpack Compose', []],
  ['SwiftUI', []],
  // Platforms and infrastructure
  ['Kubernetes', ['K8s']],
  ['Docker', []],
  ['Terraform', []],
  ['Ansible', []],
  ['Linux', []],
  ['Android', []],
  ['iOS', [], true],
  // Data stores and streaming
  ['PostgreSQL', ['Postgres']],
  ['MySQL', []],
  ['MongoDB', ['Mongo']],
  ['Redis', []],
  ['Elasticsearch', []],
  ['DynamoDB', []],
  ['Kafka', ['Apache Kafka']],
  // Data, analytics and machine learning
  ['Spark', ['Apache Spark'], true],
  ['Airflow', ['Apache Airflow']],
  ['Snowflake', [], true],
  ['dbt', []],
  ['BigQuery', []],
  ['Tableau', []],
  ['Looker', []],
  ['Power BI', []],
  ['Excel', [], true],
  ['pandas', []],
  ['PyTorch', []],
  ['TensorFlow', []],
  ['scikit-learn', ['sklearn']],
  ['machine learning', ['ML']],
  ['LLMs', ['large language models']],
  ['computer vision', []],
  // Delivery and cloud
  ['CI/CD', ['continuous integration']],
  ['GitHub Actions', []],
  ['Jenkins', []],
  ['Git', [], true],
  ['AWS', ['Amazon Web Services']],
  ['GCP', ['Google Cloud']],
  ['Azure', []],
  // Reliability, testing and security
  ['observability', []],
  ['Prometheus', []],
  ['Grafana', []],
  ['Datadog', []],
  ['Splunk', []],
  ['OpenTelemetry', []],
  ['Playwright', []],
  ['Cypress', []],
  ['Selenium', []],
  ['Jest', [], true],
  ['SIEM', []],
  // Product, design and business tools
  ['Figma', []],
  ['Jira', []],
  ['Salesforce', []],
  ['HubSpot', []],
  ['Agile', [], true],
];

/** "PostgreSQL and SQL" names one skill: SQL beside a SQL database on the same line is not listed apart. */
const SQL_DATABASES = /\b(?:PostgreSQL|Postgres|MySQL|SQL Server|SQLite|Oracle)\b/i;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS = TERMS.map(([term, synonyms, caseSensitive]) => {
  const spellings = [term, ...synonyms].map(escape).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${spellings})(?![\\p{L}\\p{N}+#])`, `gu${caseSensitive ? '' : 'i'}`);
});

const HEADINGS = [
  ['desired', /\b(?:nice[\s-]to[\s-]haves?|preferred|bonus(?: points)?|a plus|pluses|desired|desirable|good[\s-]to[\s-]have|ideally)\b/i],
  ['skip', /\b(?:benefits?|perks|what we offer|compensation|salary|pay range|equal (?:opportunity|employment)|how to apply|about (?:us|the company|the team|our))\b/i],
  ['requirements', /\b(?:requirements?|qualifications?|what you(?:['’]ll| will)? (?:need|bring|have)|who you are|about you|must[\s-]haves?|skills|experience|what we(?:['’]re| are) looking for)\b/i],
  ['responsibilities', /\b(?:responsibilit|what you(?:['’]ll| will) (?:do|work on|be doing|own)|the role|your role|in this role|duties|day[\s-]to[\s-]day|your impact)/i],
  // "About Acme Robotics" and other headings that start with "About": the company, not the role.
  ['skip', /^about\b/i],
];

const BULLET = /^\s*(?:[-*•·▪◦]|\d{1,2}[.)])\s+(.+)$/;

/** At most this many bullets per section, as the prompt asks. */
const MAX_BULLETS = 10;

function headingOf(line) {
  if (BULLET.test(line) || line.length > 80 || line.split(/\s+/).length > 8) return null;
  const text = line.replace(/[:?]\s*$/, '');
  for (const [kind, pattern] of HEADINGS) if (pattern.test(text)) return kind;
  // A short line ending in ":" that names none of the sections ends the one before it.
  return /:\s*$/.test(line) ? 'skip' : null;
}

/** The posting's bullet lines under each section heading (its short lines, when a section has no bullets). */
function sectionsOf(text) {
  const sections = { requirements: [], responsibilities: [], desired: [] };
  const loose = { requirements: [], responsibilities: [], desired: [] };
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = headingOf(line);
    if (heading) {
      current = heading === 'skip' ? null : heading;
      continue;
    }
    if (!current) continue;
    const bullet = BULLET.exec(line);
    if (bullet) sections[current].push(bullet[1].trim());
    else if (line.length <= 200 && line.split(/\s+/).length >= 3) loose[current].push(line);
  }
  for (const kind of Object.keys(sections)) {
    if (sections[kind].length === 0) sections[kind] = loose[kind];
    sections[kind] = [...new Set(sections[kind])].slice(0, MAX_BULLETS);
  }
  return sections;
}

/** The list's terms one line names, spelled as the line spells them: index -> spelling. */
function termsOfLine(line) {
  const found = new Map();
  PATTERNS.forEach((pattern, index) => {
    const match = line.match(pattern);
    if (match) found.set(index, match[0]);
  });
  const sql = TERMS.findIndex(([term]) => term === 'SQL');
  if (found.has(sql) && SQL_DATABASES.test(line.replace(/\bSQL\b(?!\s+Server)/g, ''))) found.delete(sql);
  return found;
}

function keywordsOf(title, text, sections) {
  const high = new Map();
  const low = new Map();
  for (const line of [title, ...sections.requirements]) for (const [index, spelled] of termsOfLine(line)) if (!high.has(index)) high.set(index, spelled);
  for (const line of text.split(/\r?\n/)) {
    for (const [index, spelled] of termsOfLine(line)) if (!high.has(index) && !low.has(index)) low.set(index, spelled);
  }
  const groups = (found) =>
    [...found.entries()]
      .sort(([a], [b]) => a - b)
      .slice(0, 15)
      .map(([index, spelled]) => ({ term: spelled, synonyms: TERMS[index][1].filter((synonym) => synonym.toLowerCase() !== spelled.toLowerCase()) }));
  return { high: groups(high), low: groups(low) };
}

const TITLE_LEVELS = [
  [/\b(?:intern|internship|new grad|graduate|entry[\s-]level)\b/i, 'entry'],
  [/\b(?:junior|jr\.?|associate)\b/i, 'junior'],
  [/\bmid[\s-]?level\b/i, 'mid'],
  [/\b(?:senior|sr\.?)\b/i, 'senior'],
  [/\b(?:staff|principal|lead|director|head of)\b/i, 'expert'],
];

function levelsOf(title, minYears) {
  const levels = TITLE_LEVELS.filter(([pattern]) => pattern.test(title)).map(([, level]) => level);
  if (levels.length > 0 || minYears === null) return levels;
  return [minYears < 2 ? 'entry' : minYears < 3 ? 'junior' : minYears < 5 ? 'mid' : minYears < 8 ? 'senior' : 'expert'];
}

function minYearsOf(lines) {
  for (const line of lines) {
    const match = /(\d{1,2})\s*\+?\s*(?:[-–]\s*\d{1,2}\s*)?years?/i.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The first "N years of ... experience" (or work, development, engineering) line; else the first years at all. */
function requiredYearsOf(lines) {
  const general = /(\d{1,2})\s*\+?\s*(?:[-–]\s*\d{1,2}\s*)?years?\s+(?:of\s+|in\s+)?(?:[\w/+#.-]+\s+){0,4}?(?:experience|work|development|engineering)\b/i;
  for (const line of lines) {
    const match = general.exec(line);
    if (match) return Number(match[1]);
  }
  return minYearsOf(lines);
}

/** Soft skills the fake recognises (a real model reads them off the requirements and duties). */
const SOFT_SKILLS = [
  'attention to detail',
  'communication',
  'collaboration',
  'mentoring',
  'leadership',
  'ownership',
  'problem-solving',
  'problem solving',
  'teamwork',
  'adaptability',
  'critical thinking',
  'time management',
  'stakeholder management',
  'curiosity',
  'empathy',
];
const SOFT_PATTERNS = SOFT_SKILLS.map((phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase).replace(/[ -]/g, '[\\s-]')}(?![\\p{L}\\p{N}])`, 'iu'));

/** The listed soft skills the lines name, as they spell them, each once. */
function softSkillsOf(lines) {
  const found = [];
  for (const line of lines) {
    for (const pattern of SOFT_PATTERNS) {
      const match = line.match(pattern);
      if (match && !found.some((item) => item.toLowerCase() === match[0].toLowerCase())) found.push(match[0]);
    }
  }
  return found.slice(0, 15);
}

const CERTIFICATIONS = ['AWS Certified Solutions Architect', 'Certified Kubernetes Administrator', 'CKA', 'CISSP', 'PMP', 'CompTIA Security+'];
const DOMAINS = ['fintech', 'healthcare', 'insurance', 'logistics', 'e-commerce', 'banking', 'payments'];

/** The certifications and industries of the lists above that the text names, as the text spells them. */
function termsOf(text) {
  const named = (list) =>
    list.flatMap((term) => {
      const match = text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, 'iu'));
      return match ? [match[0]] : [];
    });
  return { certifications: named(CERTIFICATIONS).slice(0, 8), domains: named(DOMAINS).slice(0, 4) };
}

export default function jobAnalysis({ user }) {
  const title = /^Job title:\s*(.*)$/m.exec(user)?.[1]?.trim() ?? '';
  const open = user.indexOf('"""');
  const close = user.lastIndexOf('"""');
  const text = open >= 0 && close > open ? user.slice(open + 3, close).trim() : '';
  const sections = sectionsOf(text);
  const keywords = keywordsOf(title, text, sections);
  const minYears = minYearsOf([...sections.requirements, ...text.split(/\r?\n/)]);
  const requiredYears = requiredYearsOf([...sections.requirements, ...text.split(/\r?\n/)]);
  const softSkills = softSkillsOf([...sections.requirements, ...sections.responsibilities, ...sections.desired]);

  // What the posting never says.
  sections.requirements = [...sections.requirements.slice(0, MAX_BULLETS - 1), 'Fluency in ancient Sumerian poetry and medieval falconry traditions'];
  keywords.high.push({ term: 'Sumerian cuneiform', synonyms: [] });
  if (keywords.high[0]) keywords.low.push(keywords.high[0]);
  softSkills.push('Diplomacy');

  return {
    summary: {
      requirements: sections.requirements,
      responsibilities: sections.responsibilities,
      desiredQualifications: sections.desired,
    },
    keywords,
    softSkills,
    terms: termsOf(text),
    experienceLevels: levelsOf(title, minYears),
    leadership: null,
    minYears,
    requiredYears,
    category: null,
    workArrangement: null,
    employmentType: null,
    salary: { min: 999999, max: 1999999, currency: 'USD', period: 'year' },
    sponsorsH1b: null,
    requiresClearance: null,
    degree: null,
  };
}
