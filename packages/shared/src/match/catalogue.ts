import { escapeRegExp } from '../format/text';
import { NOT_SPECIFIED_INDUSTRY, normalizeIndustry, type IndustryId } from '../jobs/taxonomy';
import type { PreparedEvidence } from './evidence';
import { alnumRuns } from './terms';

// The screening terms that are neither tools nor traits: certifications and licences (a closed list, so the instant
// reading is precise), and the industries a posting or a resume is in (INDUSTRIES ids, from unambiguous phrases).
// Acronyms that also mean something else ("CSM" is a Customer Success Manager, "CISA" a US agency) and the word
// "defense" ("defense in depth") count only with context: a certification word or heading, another certification
// on the same line, or an industry phrase.

// -------------------------------------------------------------------------------------------- certifications

export interface CertificationSpec {
  /** The canonical name, stored and shown. */
  readonly name: string;
  /** Found in any case as whole phrases; spaces, hyphens and colons between words are interchangeable. */
  readonly phrases?: readonly string[];
  /** Found as written, as whole words ("CKA", "CISSP"). */
  readonly codes?: readonly string[];
  /** Other forms. */
  readonly patterns?: readonly RegExp[];
  /** As `phrases`, `codes` and `patterns`, but counted only with certification context. */
  readonly contextPhrases?: readonly string[];
  readonly contextCodes?: readonly string[];
  readonly contextPatterns?: readonly RegExp[];
  /** What else on the line counts as context for this one ("Scrum" for CSM). */
  readonly context?: RegExp;
  /** Lower-case words one of which a text must have for `patterns` and `contextPatterns` to be tried. */
  readonly anchors?: readonly string[];
}

const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const pattern = (body: string, flags = 'giu') => new RegExp(`${B}(?:${body})${E}`, flags);
const plusCode = (body: string) => new RegExp(`${B}(?:${body})[\\s-]?\\+(?![\\p{L}\\p{N}+])`, 'giu');

const finraSeries = (n: number): CertificationSpec => ({
  name: `FINRA Series ${n}`,
  patterns: [pattern(String.raw`FINRA\s+Series\s*${n}`)],
  contextPatterns: [pattern(String.raw`Series\s*${n}`, 'gu')],
  context: /\bFINRA\b/,
  anchors: ['series'],
});

/** The closed list of certifications and licences the rules read. */
export const CERTIFICATIONS: readonly CertificationSpec[] = [
  // AWS
  {
    name: 'AWS Certified Solutions Architect',
    phrases: ['AWS Certified Solutions Architect', 'AWS Solutions Architect Associate', 'AWS Solutions Architect Professional'],
    patterns: [pattern(String.raw`SA[AP]-C0\d|AWS[\s-]+SA[AP]`, 'gu')],
    anchors: ['saa', 'sap', 'aws'],
  },
  {
    name: 'AWS Certified Developer',
    phrases: ['AWS Certified Developer', 'AWS Developer Associate'],
    patterns: [pattern(String.raw`DVA-C0\d`, 'gu')],
    anchors: ['dva'],
  },
  {
    name: 'AWS Certified SysOps Administrator',
    phrases: ['AWS Certified SysOps Administrator', 'AWS SysOps Administrator'],
    patterns: [pattern(String.raw`SOA-C0\d`, 'gu')],
    anchors: ['soa'],
  },
  {
    name: 'AWS Certified DevOps Engineer',
    phrases: ['AWS Certified DevOps Engineer', 'AWS DevOps Engineer Professional'],
    patterns: [pattern(String.raw`DOP-C0\d`, 'gu')],
    anchors: ['dop'],
  },
  {
    name: 'AWS Certified Cloud Practitioner',
    phrases: ['AWS Certified Cloud Practitioner', 'AWS Cloud Practitioner'],
    patterns: [pattern(String.raw`CLF-C0\d`, 'gu')],
    anchors: ['clf'],
  },
  {
    name: 'AWS Certified Security Specialty',
    phrases: ['AWS Certified Security', 'AWS Security Specialty'],
    patterns: [pattern(String.raw`SCS-C0\d`, 'gu')],
    anchors: ['scs'],
  },
  {
    name: 'AWS Certified Machine Learning Specialty',
    phrases: ['AWS Certified Machine Learning', 'AWS Machine Learning Specialty'],
    patterns: [pattern(String.raw`MLS-C0\d`, 'gu')],
    anchors: ['mls'],
  },
  {
    name: 'AWS Certified Data Engineer',
    phrases: ['AWS Certified Data Engineer', 'AWS Certified Data Analytics', 'AWS Data Engineer Associate'],
    patterns: [pattern(String.raw`DEA-C0\d`, 'gu')],
    anchors: ['dea'],
  },
  { name: 'AWS Certified Advanced Networking', phrases: ['AWS Certified Advanced Networking'] },
  // Microsoft Azure
  { name: 'Azure Fundamentals (AZ-900)', phrases: ['Azure Fundamentals'], patterns: [pattern(String.raw`AZ[\s-]?900`)], anchors: ['az', 'az900'] },
  {
    name: 'Azure Administrator Associate (AZ-104)',
    phrases: ['Azure Administrator Associate', 'Microsoft Certified Azure Administrator'],
    patterns: [pattern(String.raw`AZ[\s-]?10[34]`)],
    anchors: ['az', 'az104', 'az103'],
  },
  {
    name: 'Azure Developer Associate (AZ-204)',
    phrases: ['Azure Developer Associate', 'Microsoft Certified Azure Developer'],
    patterns: [pattern(String.raw`AZ[\s-]?204`)],
    anchors: ['az', 'az204'],
  },
  {
    name: 'Azure Solutions Architect Expert (AZ-305)',
    phrases: ['Azure Solutions Architect Expert', 'Microsoft Certified Azure Solutions Architect'],
    patterns: [pattern(String.raw`AZ[\s-]?30[345]`)],
    anchors: ['az', 'az305', 'az303', 'az304'],
  },
  {
    name: 'Azure DevOps Engineer Expert (AZ-400)',
    phrases: ['Azure DevOps Engineer Expert'],
    patterns: [pattern(String.raw`AZ[\s-]?400`)],
    anchors: ['az', 'az400'],
  },
  {
    name: 'Azure Security Engineer Associate (AZ-500)',
    phrases: ['Azure Security Engineer Associate'],
    patterns: [pattern(String.raw`AZ[\s-]?500`)],
    anchors: ['az', 'az500'],
  },
  {
    name: 'Azure Data Engineer Associate (DP-203)',
    phrases: ['Azure Data Engineer Associate'],
    patterns: [pattern(String.raw`DP[\s-]?203`)],
    anchors: ['dp', 'dp203'],
  },
  {
    name: 'Azure Data Fundamentals (DP-900)',
    phrases: ['Azure Data Fundamentals'],
    patterns: [pattern(String.raw`DP[\s-]?900`)],
    anchors: ['dp', 'dp900'],
  },
  {
    name: 'Azure AI Engineer Associate (AI-102)',
    phrases: ['Azure AI Engineer Associate'],
    patterns: [pattern(String.raw`AI[\s-]?102`)],
    anchors: ['ai', 'ai102'],
  },
  // Google Cloud
  {
    name: 'Google Cloud Professional Cloud Architect',
    phrases: ['Google Cloud Professional Cloud Architect', 'Google Professional Cloud Architect', 'GCP Professional Cloud Architect', 'Professional Cloud Architect'],
  },
  {
    name: 'Google Cloud Professional Data Engineer',
    phrases: ['Google Cloud Professional Data Engineer', 'Google Cloud Certified Professional Data Engineer', 'Google Professional Data Engineer', 'GCP Professional Data Engineer'],
  },
  {
    name: 'Google Cloud Associate Cloud Engineer',
    phrases: ['Google Cloud Associate Cloud Engineer', 'Google Associate Cloud Engineer', 'GCP Associate Cloud Engineer'],
    contextPhrases: ['Associate Cloud Engineer'],
  },
  { name: 'Google Cloud Professional Cloud DevOps Engineer', phrases: ['Professional Cloud DevOps Engineer'] },
  { name: 'Google Cloud Professional Cloud Security Engineer', phrases: ['Professional Cloud Security Engineer'] },
  {
    name: 'Google Cloud Professional Machine Learning Engineer',
    phrases: ['Google Cloud Professional Machine Learning Engineer', 'Google Professional Machine Learning Engineer', 'GCP Professional Machine Learning Engineer'],
  },
  // Containers and infrastructure as code
  { name: 'Certified Kubernetes Administrator (CKA)', phrases: ['Certified Kubernetes Administrator'], codes: ['CKA'] },
  { name: 'Certified Kubernetes Application Developer (CKAD)', phrases: ['Certified Kubernetes Application Developer'], codes: ['CKAD'] },
  { name: 'Certified Kubernetes Security Specialist (CKS)', phrases: ['Certified Kubernetes Security Specialist'], codes: ['CKS'] },
  {
    name: 'HashiCorp Certified: Terraform Associate',
    phrases: ['HashiCorp Certified Terraform Associate', 'HashiCorp Terraform Associate', 'Terraform Associate'],
  },
  { name: 'HashiCorp Certified: Vault Associate', phrases: ['HashiCorp Certified Vault Associate', 'HashiCorp Vault Associate'] },
  { name: 'Docker Certified Associate', phrases: ['Docker Certified Associate'] },
  // Security
  { name: 'CISSP', phrases: ['Certified Information Systems Security Professional'], codes: ['CISSP'] },
  { name: 'CISM', phrases: ['Certified Information Security Manager'], codes: ['CISM'] },
  { name: 'CISA', phrases: ['Certified Information Systems Auditor'], contextCodes: ['CISA'], context: /\bISACA\b/ },
  { name: 'CEH', phrases: ['Certified Ethical Hacker'], codes: ['CEH'] },
  { name: 'OSCP', phrases: ['Offensive Security Certified Professional'], codes: ['OSCP'] },
  { name: 'CCSP', phrases: ['Certified Cloud Security Professional'], codes: ['CCSP'] },
  { name: 'CRISC', phrases: ['Certified in Risk and Information Systems Control'], codes: ['CRISC'] },
  { name: 'GIAC Security Essentials (GSEC)', phrases: ['GIAC Security Essentials'], codes: ['GSEC'] },
  { name: 'GIAC Certified Incident Handler (GCIH)', phrases: ['GIAC Certified Incident Handler'], codes: ['GCIH'] },
  {
    name: 'CIPP',
    phrases: ['Certified Information Privacy Professional'],
    patterns: [pattern(String.raw`CIPP(?:\/[A-Z]{1,2})?`, 'gu')],
    anchors: ['cipp'],
  },
  {
    name: 'CompTIA Security+',
    patterns: [plusCode(String.raw`CompTIA[\s-]+Security`), new RegExp(String.raw`${B}Security\+(?![\p{L}\p{N}+])`, 'gu')],
    anchors: ['security'],
  },
  {
    name: 'CompTIA Network+',
    patterns: [plusCode(String.raw`CompTIA[\s-]+Network`), new RegExp(String.raw`${B}Network\+(?![\p{L}\p{N}+])`, 'gu')],
    anchors: ['network'],
  },
  {
    name: 'CompTIA A+',
    patterns: [plusCode(String.raw`CompTIA[\s-]+A`), pattern(String.raw`A\+[\s-]+(?:certified|certification|certificate)`)],
    anchors: ['comptia', 'a'],
  },
  { name: 'CompTIA CySA+', patterns: [plusCode(String.raw`(?:CompTIA[\s-]+)?CySA`)], anchors: ['cysa'] },
  { name: 'CompTIA PenTest+', patterns: [plusCode(String.raw`(?:CompTIA[\s-]+)?PenTest`)], anchors: ['pentest'] },
  { name: 'CompTIA CASP+', patterns: [plusCode(String.raw`(?:CompTIA[\s-]+)?CASP`)], anchors: ['casp'] },
  {
    name: 'CompTIA Linux+',
    patterns: [plusCode(String.raw`CompTIA[\s-]+Linux`), new RegExp(String.raw`${B}Linux\+(?![\p{L}\p{N}+])`, 'gu')],
    anchors: ['linux'],
  },
  { name: 'CompTIA Cloud+', patterns: [plusCode(String.raw`CompTIA[\s-]+Cloud`)], anchors: ['comptia'] },
  // Networking and Linux
  { name: 'CCNA', phrases: ['Cisco Certified Network Associate'], codes: ['CCNA'] },
  { name: 'CCNP', phrases: ['Cisco Certified Network Professional'], codes: ['CCNP'] },
  { name: 'CCIE', phrases: ['Cisco Certified Internetwork Expert'], codes: ['CCIE'] },
  { name: 'JNCIA', phrases: ['Juniper Networks Certified Associate'], codes: ['JNCIA'] },
  { name: 'RHCSA', phrases: ['Red Hat Certified System Administrator'], codes: ['RHCSA'] },
  { name: 'RHCE', phrases: ['Red Hat Certified Engineer'], codes: ['RHCE'] },
  { name: 'LFCS', phrases: ['Linux Foundation Certified System Administrator'], codes: ['LFCS'] },
  // Project, agile and service management
  { name: 'PMP', codes: ['PMP'], contextPhrases: ['Project Management Professional'] },
  { name: 'CAPM', phrases: ['Certified Associate in Project Management'], codes: ['CAPM'] },
  { name: 'PMI-ACP', phrases: ['PMI Agile Certified Practitioner'], patterns: [pattern(String.raw`PMI[\s-]?ACP`)], anchors: ['pmi', 'pmiacp'] },
  {
    name: 'Certified ScrumMaster (CSM)',
    phrases: ['Certified ScrumMaster', 'Certified Scrum Master'],
    contextCodes: ['CSM'],
    context: /\bscrum\b/i,
  },
  {
    name: 'Professional Scrum Master (PSM)',
    phrases: ['Professional Scrum Master'],
    contextPatterns: [pattern(String.raw`PSM(?:[\s-]?(?:I{1,3}|[123]))?`, 'gu')],
    context: /\bscrum\b/i,
    anchors: ['psm'],
  },
  { name: 'Certified Scrum Product Owner (CSPO)', phrases: ['Certified Scrum Product Owner'], codes: ['CSPO'] },
  { name: 'Professional Scrum Product Owner (PSPO)', phrases: ['Professional Scrum Product Owner'], codes: ['PSPO'] },
  {
    name: 'SAFe Agilist',
    patterns: [pattern(String.raw`(?:Certified\s+)?SAFe\s*®?\s*(?:\d+(?:\.\d+)?\s*)?Agilist`, 'gu')],
    anchors: ['safe'],
  },
  { name: 'PRINCE2', patterns: [pattern(String.raw`PRINCE[\s-]?2`)], anchors: ['prince', 'prince2'] },
  {
    name: 'ITIL Foundation',
    patterns: [
      pattern(String.raw`ITIL\s*®?\s*(?:v?\s?[34]\s*)?(?:Foundation|Expert|Practitioner|Managing\s+Professional|Master|Strategic\s+Leader)`),
    ],
    contextCodes: ['ITIL'],
    anchors: ['itil'],
  },
  {
    name: 'Six Sigma Black Belt',
    patterns: [pattern(String.raw`(?:Lean\s+)?Six\s+Sigma\s+Black\s+Belt`), pattern('L?SSBB', 'gu')],
    anchors: ['six', 'ssbb', 'lssbb'],
  },
  {
    name: 'Six Sigma Green Belt',
    patterns: [pattern(String.raw`(?:Lean\s+)?Six\s+Sigma\s+Green\s+Belt`), pattern('L?SSGB', 'gu')],
    anchors: ['six', 'ssgb', 'lssgb'],
  },
  { name: 'Six Sigma Yellow Belt', patterns: [pattern(String.raw`(?:Lean\s+)?Six\s+Sigma\s+Yellow\s+Belt`)], anchors: ['six'] },
  { name: 'Six Sigma', contextPhrases: ['Lean Six Sigma', 'Six Sigma'] },
  // Finance and accounting
  { name: 'CPA', phrases: ['Certified Public Accountant'], codes: ['CPA'] },
  { name: 'CFA', phrases: ['Chartered Financial Analyst'], codes: ['CFA'] },
  { name: 'FRM', codes: ['FRM'], contextPhrases: ['Financial Risk Manager'] },
  { name: 'CMA', phrases: ['Certified Management Accountant'], contextCodes: ['CMA'] },
  { name: 'CFP', phrases: ['Certified Financial Planner'], contextCodes: ['CFP'], context: /\b(?:CFA|CPA)\b|financial\s+plann/i },
  { name: 'Certified Internal Auditor', phrases: ['Certified Internal Auditor'] },
  finraSeries(7),
  finraSeries(24),
  finraSeries(63),
  finraSeries(65),
  finraSeries(66),
  // People
  { name: 'SHRM-CP', patterns: [pattern(String.raw`SHRM[\s-]?CP`)], anchors: ['shrm', 'shrmcp'] },
  { name: 'SHRM-SCP', patterns: [pattern(String.raw`SHRM[\s-]?SCP`)], anchors: ['shrm', 'shrmscp'] },
  {
    name: 'PHR',
    phrases: ['Professional in Human Resources'],
    contextCodes: ['PHR'],
    context: /\b(?:HRCI|SHRM|SPHR)\b|human\s+resources/i,
  },
  { name: 'SPHR', phrases: ['Senior Professional in Human Resources'], codes: ['SPHR'] },
  // Platforms and data
  {
    name: 'Salesforce Certified Administrator',
    patterns: [pattern(String.raw`(?:Salesforce[\s-]+Certified|Certified[\s-]+Salesforce)[\s-]+(?:Platform[\s-]+)?Administrator`)],
    contextPhrases: ['Salesforce Administrator', 'Salesforce Platform Administrator'],
    anchors: ['salesforce'],
  },
  {
    name: 'Salesforce Certified Platform Developer',
    patterns: [pattern(String.raw`(?:Salesforce[\s-]+Certified|Certified[\s-]+Salesforce)[\s-]+Platform[\s-]+Developer`)],
    contextPhrases: ['Salesforce Platform Developer'],
    anchors: ['salesforce'],
  },
  { name: 'ISTQB Certified Tester', codes: ['ISTQB'] },
  { name: 'Databricks Certified', patterns: [pattern(String.raw`Databricks[\s-]+Certified`)], anchors: ['databricks'] },
  { name: 'Snowflake SnowPro', patterns: [pattern('SnowPro')], anchors: ['snowpro'] },
  {
    name: 'Oracle Certified Professional',
    patterns: [pattern(String.raw`Oracle[\s-]+Certified[\s-]+(?:Professional|Associate|Master|Expert)`)],
    anchors: ['oracle'],
  },
];

/** A certification name's key: lower case, letters, digits and "+" only ("CompTIA Security+" -> "comptiasecurity+"). */
export function certificationKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '');
}

const PHRASE_GAP = String.raw`[\s\-\u2010\u2011–—:]+`;

function phrasesPattern(phrases: readonly string[] | undefined): RegExp | null {
  const bodies = (phrases ?? [])
    .map((phrase) => phrase.trim().split(/\s+/).map(escapeRegExp).join(PHRASE_GAP))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return bodies.length > 0 ? new RegExp(`${B}(?:${bodies.join('|')})${E}`, 'giu') : null;
}

function codesPattern(codes: readonly string[] | undefined): RegExp | null {
  const bodies = (codes ?? []).map(escapeRegExp).sort((a, b) => b.length - a.length);
  return bodies.length > 0 ? new RegExp(`${B}(?:${bodies.join('|')})${E}`, 'gu') : null;
}

function withGlobal(regex: RegExp): RegExp {
  return regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
}

interface CompiledCertification {
  readonly name: string;
  readonly plain: readonly RegExp[];
  readonly contextual: readonly RegExp[];
  readonly context: RegExp | null;
  /** First words of its phrases and codes, and its anchors: a text without any of them cannot name it. */
  readonly anchors: readonly string[];
}

function firstRunOf(text: string): string {
  return /[A-Za-z0-9]+/.exec(text)?.[0]?.toLowerCase() ?? '';
}

const COMPILED_CERTIFICATIONS: readonly CompiledCertification[] = CERTIFICATIONS.map((spec) => {
  const plain = [phrasesPattern(spec.phrases), codesPattern(spec.codes), ...(spec.patterns ?? []).map(withGlobal)];
  const contextual = [
    phrasesPattern(spec.contextPhrases),
    codesPattern(spec.contextCodes),
    ...(spec.contextPatterns ?? []).map(withGlobal),
  ];
  const anchors = new Set<string>(spec.anchors ?? []);
  for (const text of [...(spec.phrases ?? []), ...(spec.codes ?? []), ...(spec.contextPhrases ?? []), ...(spec.contextCodes ?? [])]) {
    const run = firstRunOf(text);
    if (run) anchors.add(run);
  }
  return {
    name: spec.name,
    plain: plain.filter((regex): regex is RegExp => regex !== null),
    contextual: contextual.filter((regex): regex is RegExp => regex !== null),
    context: spec.context ?? null,
    anchors: [...anchors],
  };
});

/** Words on a line that make an ambiguous acronym a certification. */
const CERTIFICATION_CONTEXT = /certifi(?:ed|cations?|cates?)\b|\bcredentials?\b|\blicen[cs](?:e|es|ed|ure|ing)\b|\baccredit/i;
const HEADING_WORD = String.raw`(?:licen[cs]es?|certifications?|certificates?|credentials?|accreditations?)`;
/** "Certifications", "Licenses & Certifications", "CERTIFICATES:": a line of nothing but those words. */
const CERTIFICATION_HEADING = new RegExp(
  String.raw`^[\W_]*(?:(?:professional|key|relevant)\s+)?${HEADING_WORD}(?:\s*(?:&|and|,|\/)\s*${HEADING_WORD})*[\W_]*$`,
  'i',
);
const OTHER_HEADING =
  /^[\W_]*(?:(?:professional|work|relevant)\s+)?(?:experience|education|(?:technical\s+|core\s+|key\s+|soft\s+)?skills|projects|summary|profile|objective|awards|hono(?:u)?rs|publications|languages|interests|references|volunteer(?:ing)?|activities|courses|training|employment(?:\s+history)?|work\s+history|achievements|(?:key\s+)?strengths)[\W_]*$/i;

interface LineMap {
  readonly starts: readonly number[];
  readonly lines: readonly string[];
  /** Whether each line sits under a Certifications / Licenses heading. */
  readonly certificationSection: readonly boolean[];
}

function lineMapOf(text: string): LineMap {
  const lines = text.split('\n');
  const starts: number[] = [];
  const certificationSection: boolean[] = [];
  let offset = 0;
  let inSection = false;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed && CERTIFICATION_HEADING.test(trimmed)) inSection = true;
    else if (trimmed && trimmed.split(/\s+/).length <= 4 && OTHER_HEADING.test(trimmed)) inSection = false;
    certificationSection.push(inSection);
  }
  return { starts, lines, certificationSection };
}

function lineIndexOf(map: LineMap, offset: number): number {
  let low = 0;
  let high = map.starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (map.starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Text spans already read as a certification: each span counts for one. */
class Claims {
  private readonly claimed: Uint8Array;
  constructor(length: number) {
    this.claimed = new Uint8Array(length);
  }
  free(start: number, end: number): boolean {
    for (let at = start; at < end; at += 1) if (this.claimed[at]) return false;
    return true;
  }
  claim(start: number, end: number) {
    this.claimed.fill(1, start, end);
  }
}

export interface FindCertificationsOptions {
  /** At most this many, in the order the text first names them (default 10). */
  max?: number;
  /** The text is known to name certifications (a resume's certification entries, an AI answer's list). */
  assumeContext?: boolean;
}

/**
 * The certifications a text names (closed list), by canonical name, in the order it first names them. A form spelled
 * out ("Certified Kubernetes Administrator") or an unambiguous code ("CKA") counts anywhere; an ambiguous one only
 * with context. A text span counts for one certification, so "Lean Six Sigma Green Belt" is not also "Six Sigma".
 * Prepared evidence is read as its masked text, and its run index spares a second pass over it.
 */
export function findCertifications(
  source: string | PreparedEvidence,
  options: FindCertificationsOptions = {},
): string[] {
  const text = typeof source === 'string' ? source : (source?.masked ?? '');
  if (typeof text !== 'string' || !text.trim()) return [];
  const runs: { has(run: string): boolean } = typeof source === 'string' ? alnumRuns(text) : source.runs;
  const candidates = COMPILED_CERTIFICATIONS.filter((spec) => spec.anchors.length === 0 || spec.anchors.some((run) => runs.has(run)));
  if (candidates.length === 0) return [];
  const claims = new Claims(text.length);
  const accepted: number[] = [];
  const first = new Map<string, number>();
  const accept = (name: string, start: number, end: number) => {
    claims.claim(start, end);
    accepted.push(start);
    if (!first.has(name)) first.set(name, start);
  };
  for (const spec of candidates) {
    for (const regex of spec.plain) {
      for (const match of text.matchAll(regex)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (claims.free(start, end)) accept(spec.name, start, end);
      }
    }
  }
  const contextual = candidates.filter((spec) => spec.contextual.length > 0);
  if (contextual.length > 0) {
    const map = lineMapOf(text);
    const certificationLines = new Set(accepted.map((start) => lineIndexOf(map, start)));
    // Each line's context is read once (a long line with many acronyms would otherwise be re-read per hit).
    const lineContext = new Map<number, boolean>();
    const hasLineContext = (lineIndex: number) => {
      let known = lineContext.get(lineIndex);
      if (known === undefined) {
        known = CERTIFICATION_CONTEXT.test(map.lines[lineIndex] ?? '');
        lineContext.set(lineIndex, known);
      }
      return known;
    };
    for (const spec of contextual) {
      const ownContext = new Map<number, boolean>();
      for (const regex of spec.contextual) {
        for (const match of text.matchAll(regex)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          if (!claims.free(start, end)) continue;
          const lineIndex = lineIndexOf(map, start);
          let own = ownContext.get(lineIndex);
          if (own === undefined) {
            own = spec.context?.test(map.lines[lineIndex] ?? '') ?? false;
            ownContext.set(lineIndex, own);
          }
          const hasContext =
            options.assumeContext === true ||
            hasLineContext(lineIndex) ||
            own ||
            map.certificationSection[lineIndex] === true ||
            certificationLines.has(lineIndex);
          if (hasContext) accept(spec.name, start, end);
        }
      }
    }
  }
  return [...first.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name)
    .slice(0, options.max ?? 10);
}

/** The canonical name of a certification as written ("AWS Solutions Architect - Associate"), or null. */
export function canonicalCertification(name: string): string | null {
  return findCertifications(name, { max: 1, assumeContext: true })[0] ?? null;
}

// -------------------------------------------------------------------------------------------------- industries

interface DomainSpec {
  readonly id: IndustryId;
  /** Found in any case, as whole phrases. */
  readonly phrases?: readonly string[];
  /** Found as written ("DoD", "NGO"). */
  readonly codes?: readonly string[];
  readonly patterns?: readonly RegExp[];
  /** Lower-case words one of which a text must have for `patterns` to be tried. */
  readonly anchors?: readonly string[];
}

const DEFENSE_CONTEXT = String.raw`(?:aerospace\s*(?:and|&)\s*defen[cs]e|defen[cs]e\s*(?:and|&)\s*aerospace|(?:department\s+of|national|missile|u\.?s\.?)\s+defen[cs]e|defen[cs]e\s+(?:industry|industries|sector|contractors?|companies|company|programs?|agenc(?:y|ies)|clients?|customers?|department|primes?|market|electronics|technolog(?:y|ies)|acquisition|logistics|community|organi[sz]ations?|systems\s+integrators?))`;

/**
 * Unambiguous phrases per industry. Left out: words that are also technical terms or headings ("education",
 * "streaming", "shipping", "utilities", "marketplace", "industrial", "media" on its own), "technology" (every posting
 * here), and "defense" without an industry around it.
 */
const DOMAINS: readonly DomainSpec[] = [
  {
    id: 'finance',
    phrases: [
      'fintech', 'fin-tech', 'financial services', 'financial institution', 'financial institutions', 'financial industry',
      'banking', 'investment bank', 'investment banking', 'capital markets', 'wealth management', 'hedge fund',
      'hedge funds', 'private equity', 'venture capital', 'brokerage', 'payments', 'payment processing', 'lending',
      'credit union', 'credit unions', 'neobank',
    ],
    patterns: [
      pattern(String.raw`(?<!\b(?:it|software|digital|hardware|fixed)\s)asset\s+management`),
      pattern(String.raw`trading(?!\s+cards?)`),
    ],
    anchors: ['asset', 'trading'],
  },
  { id: 'insurance', phrases: ['insurtech', 'reinsurance', 'insurance'] },
  {
    id: 'healthcare',
    phrases: [
      'healthcare', 'health care', 'healthtech', 'health tech', 'digital health', 'clinical', 'pharmaceutical',
      'pharmaceuticals', 'pharma', 'biotech', 'biotechnology', 'life sciences', 'hospital', 'hospitals', 'health system',
      'health systems', 'patient care', 'telehealth', 'telemedicine', 'medtech', 'medical devices',
    ],
    codes: ['EHR', 'EMR', 'HIPAA'],
    patterns: [pattern(String.raw`medical(?!\s*(?:,|and|&)?\s*(?:leave|dental|vision|insurance|benefits?|coverage|plans?))`)],
    anchors: ['medical'],
  },
  {
    id: 'government',
    phrases: ['public sector', 'govtech', 'gov-tech', 'federal agency', 'federal agencies', 'state agency', 'state agencies', 'public administration', 'civic tech'],
    patterns: [pattern(String.raw`government(?![\s-]*(?:issued|id|identification))`)],
    anchors: ['government'],
  },
  {
    id: 'military',
    phrases: ['armed forces', 'U.S. Army', 'US Army', 'U.S. Navy', 'US Navy', 'U.S. Air Force', 'US Air Force', 'Marine Corps', 'Coast Guard', 'Space Force'],
    codes: ['DoD'],
    patterns: [
      pattern(DEFENSE_CONTEXT),
      pattern(String.raw`military(?!\s+(?:status|spouses?|veterans?|leave|time|famil(?:y|ies)|members?|service\s+members?|discounts?))`),
    ],
    anchors: ['defense', 'defence', 'military'],
  },
  { id: 'education', phrases: ['edtech', 'ed-tech', 'higher education', 'education technology', 'school district', 'school districts', 'e-learning'], codes: ['K-12', 'K12'] },
  { id: 'retail_ecommerce', phrases: ['e-commerce', 'ecommerce', 'retail', 'omnichannel', 'direct-to-consumer'] },
  {
    id: 'logistics_transportation',
    phrases: ['logistics', 'supply chain', 'freight', 'trucking', 'fleet management', 'last-mile delivery'],
    patterns: [pattern(String.raw`transportation(?!\s+(?:benefits?|stipends?|allowances?|reimbursements?|subsid(?:y|ies)))`)],
    anchors: ['transportation'],
  },
  { id: 'manufacturing', phrases: ['manufacturing', 'automotive', 'semiconductor', 'semiconductors', 'industrial automation', 'factory automation'] },
  { id: 'telecommunications', phrases: ['telecom', 'telecoms', 'telecommunications', 'telco', 'telcos', 'wireless carrier', 'wireless carriers', 'mobile network operator', 'mobile network operators'] },
  { id: 'real_estate', phrases: ['real estate', 'proptech', 'prop-tech', 'property management'] },
  { id: 'hospitality_travel', phrases: ['hospitality', 'hotel', 'hotels', 'airline', 'airlines', 'travel industry', 'travel tech', 'online travel', 'cruise line', 'cruise lines', 'restaurant industry'] },
  { id: 'nonprofit', phrases: ['nonprofit', 'nonprofits', 'non-profit', 'non-profits', 'not-for-profit', 'charitable organization', 'charitable organisation'], codes: ['NGO', 'NGOs'] },
  {
    id: 'media_entertainment',
    phrases: [
      'media and entertainment', 'media & entertainment', 'entertainment industry', 'gaming', 'video game', 'video games',
      'game studio', 'game studios', 'film and television', 'film & television', 'film & TV', 'broadcasting',
      'broadcast media', 'music industry', 'publishing industry',
    ],
  },
  { id: 'legal', phrases: ['legal tech', 'legaltech', 'law firm', 'law firms', 'legal services', 'legal industry'] },
  {
    id: 'energy_utilities',
    phrases: [
      'energy sector', 'energy industry', 'energy company', 'energy companies', 'oil and gas', 'oil & gas',
      'renewable energy', 'renewables', 'clean energy', 'solar energy', 'wind energy', 'utility company',
      'utility companies', 'electric utility', 'electric utilities', 'power grid',
    ],
  },
  { id: 'consulting', phrases: ['consulting firm', 'consulting firms', 'management consulting', 'consultancy', 'consultancies', 'professional services firm'] },
];

const COMPILED_DOMAINS = DOMAINS.map((spec) => {
  const anchors = new Set<string>(spec.anchors ?? []);
  for (const text of [...(spec.phrases ?? []), ...(spec.codes ?? [])]) {
    const run = firstRunOf(text);
    if (run) anchors.add(run);
  }
  return {
    id: spec.id,
    regexes: [phrasesPattern(spec.phrases), codesPattern(spec.codes), ...(spec.patterns ?? []).map(withGlobal)].filter(
      (regex): regex is RegExp => regex !== null,
    ),
    anchors: [...anchors],
  };
});

/** Equal-opportunity, benefits and legal lines: their words say nothing about the industry. */
const BOILERPLATE_LINE =
  /equal\s+(?:employment\s+)?opportunit|without\s+regard|regardless\s+of|protected\s+(?:veteran|class|characteristic|status)|discriminat|reasonable\s+accommodation|e-verify|affirmative\s+action|\bbenefits?\b|401\s*\(?k\)?|paid\s+time\s+off|\bPTO\b|parental\s+leave|health\s+insurance|medical,\s*dental|dental\s+and\s+vision|commuter|stipend/i;

function lineAround(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * The industries a text is in (INDUSTRIES ids), in the order it first names them; never technology or other.
 * Equal-opportunity and benefits lines are not read ("medical, dental and vision", "military status").
 */
export function findDomains(source: string | PreparedEvidence, max = 5): IndustryId[] {
  const text = typeof source === 'string' ? source : (source?.masked ?? '');
  if (typeof text !== 'string' || !text.trim()) return [];
  const runs: { has(run: string): boolean } = typeof source === 'string' ? alnumRuns(text) : source.runs;
  const first = new Map<IndustryId, number>();
  for (const spec of COMPILED_DOMAINS) {
    if (!spec.anchors.some((run) => runs.has(run))) continue;
    for (const regex of spec.regexes) {
      for (const match of text.matchAll(regex)) {
        const at = match.index ?? 0;
        if (at >= (first.get(spec.id) ?? Number.MAX_SAFE_INTEGER)) break;
        if (BOILERPLATE_LINE.test(lineAround(text, at))) continue;
        first.set(spec.id, at);
        break;
      }
    }
  }
  return [...first.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id)
    .slice(0, max);
}

/**
 * The industry an industry name means ("FinTech", "Aerospace & Defense", "Healthcare"), for an AI answer's domains or a
 * company's industry; null for technology, other, not specified and anything unknown.
 */
export function domainOf(name: string): IndustryId | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const named = normalizeIndustry(name);
  if (named && named !== 'technology' && named !== 'other' && named !== NOT_SPECIFIED_INDUSTRY) return named;
  if (named) return null;
  return findDomains(name, 1)[0] ?? null;
}
