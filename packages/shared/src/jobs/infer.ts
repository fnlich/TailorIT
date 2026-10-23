import {
  EXPERIENCE_LEVELS,
  type EmploymentType,
  type ExperienceLevel,
  type Leadership,
  type WorkArrangement,
} from './enums';
import { OTHER_CATEGORY_ID, type JobCategoryId, type JobSubcategoryId } from './taxonomy';

// Deterministic readings of a posting, used at ingest (before, or instead of, the AI analysis) and by the CSV import.
// Structured ATS fields always win over these; they are the fallback for the title and the description text.

// ------------------------------------------------------------------------------------------ experience levels

const LEVEL_ORDER = new Map<ExperienceLevel, number>(EXPERIENCE_LEVELS.map((level, index) => [level, index]));

function inLevelOrder(levels: Iterable<ExperienceLevel>): ExperienceLevel[] {
  return [...new Set(levels)].sort((a, b) => (LEVEL_ORDER.get(a) ?? 0) - (LEVEL_ORDER.get(b) ?? 0));
}

const INTERN_TITLE = /\bintern(?:ship)?s?\b|\bco-?op\b|\bapprentice(?:ship)?\b/i;

const TITLE_LEVEL_RULES: ReadonlyArray<readonly [RegExp, ExperienceLevel]> = [
  [INTERN_TITLE, 'entry'],
  [
    /\bnew[\s-]?grad(?:uate)?s?\b|\b(?:recent|university|college)\s+grad(?:uate)?s?\b|\bgraduate\b|\bentry[\s-]level\b|\bearly[\s-]career\b|\bcampus\b/i,
    'entry',
  ],
  [/\bjunior\b|\bjr\b/i, 'junior'],
  [/\bmid[\s-]?level\b|\bmid[\s-]senior\b|\bintermediate\b/i, 'mid'],
  [/\bsenior\b|\bsr\b/i, 'senior'],
  [
    /\bstaff\b(?!\s+(?:accountant|nurse|auditor|writer|assistant))|\bprincipal\b|\blead\b|\bdistinguished\b|\bfellow\b|\bdirector\b|\bhead\s+of\b|\bvp\b|\bvice\s+president\b|\bchief\b|\bc[tei]o\b/i,
    'expert',
  ],
];

/** "Engineer II", "Analyst 3", "L5": a ladder rung, read only when the title has no level word. */
const LADDER = /\b(?:engineer|developer|scientist|analyst|designer|programmer|administrator|consultant|specialist|architect|manager)\s*,?\s*(iv|v|i{1,3}|[1-5])\b(?![.\d])/i;
const GOOGLE_LEVEL = /\bL([3-8])\b/;

const LADDER_LEVELS: Record<string, readonly ExperienceLevel[]> = {
  i: ['entry'],
  '1': ['entry'],
  ii: ['junior', 'mid'],
  '2': ['junior', 'mid'],
  iii: ['senior'],
  '3': ['senior'],
  iv: ['expert'],
  '4': ['expert'],
  v: ['expert'],
  '5': ['expert'],
};

function titleLevels(title: string): ExperienceLevel[] {
  const found: ExperienceLevel[] = TITLE_LEVEL_RULES.filter(([pattern]) => pattern.test(title)).map(([, level]) => level);
  // "Associate" is junior only on its own ("Associate Product Manager", not "Associate Director").
  if (found.length === 0 && /\bassociate\b/i.test(title)) found.push('junior');
  if (found.length > 0) return inLevelOrder(found);
  const rung = LADDER.exec(title)?.[1]?.toLowerCase();
  if (rung && LADDER_LEVELS[rung]) return [...LADDER_LEVELS[rung]!];
  const level = GOOGLE_LEVEL.exec(title)?.[1];
  if (level) {
    const n = Number(level);
    return [n <= 3 ? 'entry' : n === 4 ? 'mid' : n === 5 ? 'senior' : 'expert'];
  }
  return [];
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
};

const YEARS_MENTION =
  /(?<lead>at\s+least|minimum(?:\s+of)?|min\.?|over|more\s+than)?\s*\b(?<from>\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s*(?<plus>\+)?\s*(?:(?:-|–|—|to)\s*(?<to>\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b(?=(?<after>[^.\n;]{0,80}))/gi;
const EXPERIENCE_CONTEXT = /experience|\bexp\b|background|professional|industry|hands-on|working|relevant|track record/i;

/** One accepted "N years" mention: its lower bound and, for a range, its upper bound. */
function yearMentions(text: string): Array<{ from: number; to: number | null }> {
  const mentions: Array<{ from: number; to: number | null }> = [];
  for (const match of text.matchAll(YEARS_MENTION)) {
    const groups = match.groups ?? {};
    const fromText = (groups.from ?? '').toLowerCase();
    const from = WORD_NUMBERS[fromText] ?? Number(fromText);
    if (!Number.isFinite(from) || from > 30) continue;
    const strong = Boolean(groups.plus || groups.lead);
    if (!strong && !EXPERIENCE_CONTEXT.test(groups.after ?? '')) continue;
    const to = groups.to ? Number(groups.to) : null;
    mentions.push({ from, to: to !== null && to > from && to <= 40 ? to : null });
  }
  return mentions;
}

/** The fewest years of experience a posting asks for ("5+ years", "3-5 years of experience"), or null. */
export function inferMinYears(text: string | null | undefined): number | null {
  const mentions = yearMentions(text ?? '');
  return mentions.length > 0 ? Math.min(...mentions.map((mention) => mention.from)) : null;
}

/** Year bands: entry [0,2), junior [2,3), mid [3,5), senior [5,8), expert [8,...). */
const YEAR_BANDS: ReadonlyArray<readonly [ExperienceLevel, number, number]> = [
  ['entry', 0, 2],
  ['junior', 2, 3],
  ['mid', 3, 5],
  ['senior', 5, 8],
  ['expert', 8, Infinity],
];

/** The levels "N years" (or a range "N-M years", read as [N, M)) falls in. */
export function levelsForYears(from: number, to: number | null = null): ExperienceLevel[] {
  if (to === null || to <= from) {
    const band = YEAR_BANDS.find(([, low, high]) => from >= low && from < high);
    return band ? [band[0]] : [];
  }
  return YEAR_BANDS.filter(([, low, high]) => from < high && to > low).map(([level]) => level);
}

/**
 * The experience levels a posting is for, from its title ("Senior", "Staff", "New Grad", "Engineer II") and the years
 * of experience its text asks for (0-1 entry, 2-3 junior, 3-5 mid, 5-8 senior, 8+ expert; the smallest stated minimum
 * decides). An internship is Entry whatever its text says. [] when neither says anything.
 */
export function inferExperienceLevels(title: string | null | undefined, text?: string | null): ExperienceLevel[] {
  const name = title ?? '';
  const fromTitle = titleLevels(name);
  if (INTERN_TITLE.test(name)) return ['entry'];
  const mentions = yearMentions(text ?? '');
  let fromYears: ExperienceLevel[] = [];
  if (mentions.length > 0) {
    const smallest = mentions.reduce((best, mention) => (mention.from < best.from ? mention : best));
    fromYears = levelsForYears(smallest.from, smallest.to);
  }
  return inLevelOrder([...fromTitle, ...fromYears]);
}

// ---------------------------------------------------------------------------------------- employment type

const TYPE_WORDS: ReadonlyArray<readonly [EmploymentType, RegExp]> = [
  ['internship', /\bintern(?:ship)?s?\b|\bco-?op\b/i],
  ['part_time', /\bpart[\s-]?time\b/i],
  ['contract', /\bcontract(?:or)?\b|\bfreelance(?:r)?\b|\btemporary\b|\btemp\b|\bc2c\b|\b1099\b|\bfixed[\s-]term\b/i],
  ['full_time', /\bfull[\s-]?time\b|\bpermanent\b/i],
];

function typeOfWord(word: string): EmploymentType | null {
  for (const [type, pattern] of TYPE_WORDS) if (pattern.test(word)) return type;
  return null;
}

const TYPE_LABEL_LINE =
  /\b(?:employment|job|position|role|work|contract)\s*(?:type|status)\s*[:-]\s*(full[\s-]?time|part[\s-]?time|contract(?:or)?|temporary|internship|intern|freelance|permanent)/i;
const TYPE_SENTENCE =
  /\b(?:this|the)\s+(?:is\s+an?|position\s+is(?:\s+an?)?|role\s+is(?:\s+an?)?|opportunity\s+is(?:\s+an?)?)\s+(?:\w+\s+){0,2}?(full[\s-]?time|part[\s-]?time|contract|temporary|internship|freelance)\b/i;

/**
 * The employment type: the title's word first ("Intern", "Part-Time", "Contract", "Full-Time"), then a labelled line
 * or a sentence in the text ("Employment type: Contract", "This is a full-time role"), then a type named early in the
 * text. Null when nothing says (the caller defaults to Full-Time).
 */
export function inferEmploymentType(title: string | null | undefined, text?: string | null): EmploymentType | null {
  const fromTitle = typeOfWord(title ?? '');
  if (fromTitle) return fromTitle;
  const body = text ?? '';
  const labelled = TYPE_LABEL_LINE.exec(body)?.[1] ?? TYPE_SENTENCE.exec(body)?.[1];
  if (labelled) return typeOfWord(labelled);
  const opening = body.slice(0, 400);
  for (const [type, pattern] of TYPE_WORDS) {
    if (type === 'internship' && !/\binternship\b|\bco-?op\b/i.test(opening)) continue;
    if (pattern.test(opening)) return type;
  }
  if (TYPE_WORDS[3]![1].test(body)) return 'full_time';
  return null;
}

// --------------------------------------------------------------------------------------- work arrangement

const HYBRID =
  /\bhybrid\b|\b(?:\d|one|two|three|four)\s+days?\s+(?:a|per)\s+week\s+(?:in|at|from)\s+(?:the\s+|our\s+)?office\b|\bpartially\s+remote\b|\bremote[\s-]+(?:and|&|\/)[\s-]+(?:in[\s-]office|on[\s-]?site)\b/i;
const NOT_REMOTE =
  /\bnot\s+(?:a\s+)?remote\b|\bno\s+remote\b|\bremote\s+(?:work\s+)?(?:is\s+)?not\s+(?:available|possible|an\s+option|offered)\b/i;
const REMOTE = /\bremote\b|\bwork\s+from\s+(?:home|anywhere)\b|\bwfh\b|\bfully\s+distributed\b|\btelecommut/i;
const ONSITE = /\bon[\s-]?site\b|\bin[\s-]office\b|\bin[\s-]person\b|\bin\s+our\s+office\b/i;

function arrangementIn(text: string): WorkArrangement | null {
  if (!text) return null;
  if (HYBRID.test(text)) return 'hybrid';
  if (NOT_REMOTE.test(text)) return 'onsite';
  if (REMOTE.test(text)) return 'remote';
  if (ONSITE.test(text)) return 'onsite';
  return null;
}

/**
 * Remote, Hybrid or In Person, from the location text first (the stronger signal) and then the description: hybrid
 * wording wins over remote ("3 days a week in the office"), "not remote" reads as on-site. Null when nothing says.
 */
export function inferWorkArrangement(text: string | null | undefined, locationText?: string | null): WorkArrangement | null {
  return arrangementIn(locationText ?? '') ?? arrangementIn(text ?? '');
}

const PEOPLE_MANAGER =
  /\b(?:engineering|software|development|people|team|general|it|operations|delivery|support|sales|store|district|regional|hiring)\s+manager\b|\bmanager\s+of\b|\bdirector\b|\bhead\s+of\b|\bvp\b|\bvice\s+president\b|\bchief\b|\bc[tei]o\b|\bsupervisor\b/i;

/** Manager for people-leading titles (Engineering Manager, Director, Head of, VP); every other title is IC. */
export function inferLeadership(title: string | null | undefined): Leadership {
  return PEOPLE_MANAGER.test(title ?? '') ? 'manager' : 'ic';
}

// ------------------------------------------------------------------------------------------- title category

/** Pattern, category, subcategory, and whether it is a catch-all (its subcategory counts only when nothing finer does). */
type Rule = readonly [RegExp, JobCategoryId, JobSubcategoryId | null, boolean?];

/**
 * In order: role nouns first (a "Product Manager, AI" is Product, a "Recruiter, Engineering" People & HR), then the
 * engineering specialities from the most to the least specific, then software in general.
 */
const TITLE_RULES: readonly Rule[] = [
  [/\b(?:engineering|software|development)\s+(?:manager|director)\b|\bmanager,?\s+(?:software\s+)?engineering\b|\b(?:head|director|vp|vice\s+president)\s+of\s+(?:engineering|software|development|technology)\b|\bcto\b|\bchief\s+technology\s+officer\b/i, 'engineering-management', 'engineering-leadership'],
  [/\btechnical\s+program\s+manager\b|\btpm\b|\bprogram\s+manager\b/i, 'engineering-management', 'program-management'],
  [/\bscrum\s+master\b|\bagile\s+coach\b|\bdelivery\s+manager\b/i, 'engineering-management', 'agile-delivery'],
  [/\btechnical\s+product\s+manager\b/i, 'product', 'technical-product-management'],
  [/\bproduct\s+(?:manager|owner|lead|director)\b|\b(?:head|director|vp)\s+of\s+product\b|\bchief\s+product\s+officer\b|\bapm\b/i, 'product', 'product-management'],
  [/\bbusiness\s+analyst\b|\brequirements\s+analyst\b/i, 'product', 'business-analysis'],
  [/\btechnical\s+writer\b|\bdocumentation\s+(?:engineer|writer)\b/i, 'product', 'technical-writing'],
  [/\blocali[sz]ation\b|\binternationali[sz]ation\b/i, 'product', 'localization'],
  [/\bux\s+research(?:er)?\b|\buser\s+research(?:er)?\b/i, 'design', 'ux-research'],
  [/\bdesign\s+systems?\b/i, 'design', 'design-systems'],
  [/\b(?:visual|graphic|brand|motion)\s+designer\b/i, 'design', 'visual-design'],
  [/\b(?:product|ux|ui|ui\/ux|ux\/ui|interaction|experience)\s+designer\b|\bdesigner\b|\bhead\s+of\s+design\b|\bdesign\s+(?:lead|director|manager)\b/i, 'design', 'product-design'],
  [/\brecruit(?:er|ing|ment)\b|\btalent\s+(?:acquisition|partner|sourcer)\b|\bsourcer\b/i, 'people-hr', 'recruiting'],
  [/\bcompensation\b|\bbenefits\s+(?:manager|specialist|analyst)\b|\btotal\s+rewards\b/i, 'people-hr', 'compensation-benefits'],
  [/\blearning\s+(?:and|&)\s+development\b|\bl&d\b|\btraining\s+(?:manager|specialist)\b/i, 'people-hr', 'learning-development'],
  [/\bhuman\s+resources\b|\bhr\s+(?:business\s+partner|generalist|manager|specialist|coordinator)\b|\bhrbp\b|\bpeople\s+(?:operations|partner|ops)\b/i, 'people-hr', 'people-operations'],
  [/\b(?:general\s+)?counsel\b|\battorney\b|\blawyer\b|\bparalegal\b|\blegal\s+(?:operations|specialist|manager|analyst)\b/i, 'legal', 'legal-counsel'],
  [/\bcontracts?\s+(?:manager|specialist|administrator)\b/i, 'legal', 'contracts'],
  [/\bcompliance\s+(?:officer|manager|analyst|specialist)\b/i, 'legal', 'compliance'],
  [/\baccountant\b|\baccounting\b|\bcontroller\b|\bbookkeeper\b|\baccounts\s+(?:payable|receivable)\b/i, 'finance', 'accounting'],
  [/\bfp&a\b|\bfinancial\s+(?:analyst|planning)\b|\bfinance\s+(?:manager|director|associate|lead|partner)\b|\bcfo\b/i, 'finance', 'financial-planning'],
  [/\btax\s+(?:manager|analyst|associate|specialist)\b|\bauditor\b|\binternal\s+audit\b/i, 'finance', 'audit-tax'],
  [/\binvestment\b|\binvestor\s+relations\b|\bportfolio\s+manager\b|\bquant(?:itative)?\s+(?:analyst|trader|researcher)\b|\btrader\b/i, 'finance', 'investment'],
  [/\bdeveloper\s+(?:advocate|relations|evangelist)\b|\bdevrel\b/i, 'marketing', 'developer-relations'],
  [/\bproduct\s+marketing\b/i, 'marketing', 'product-marketing'],
  [/\bgrowth\s+(?:marketing|marketer|manager)\b|\bperformance\s+marketing\b|\bdemand\s+generation\b|\bpaid\s+(?:media|social|search)\b/i, 'marketing', 'growth-marketing'],
  [/\bcontent\s+(?:marketing|strategist|writer|manager)\b|\bcopywriter\b/i, 'marketing', 'content-marketing'],
  [/\bseo\b/i, 'marketing', 'seo'],
  [/\bcommunications\s+(?:manager|specialist|lead)\b|\bpublic\s+relations\b|\bpr\s+manager\b|\bbrand\s+(?:manager|marketing)\b|\bsocial\s+media\b/i, 'marketing', 'brand-communications'],
  [/\bmarketing\s+(?:manager|lead|director|specialist|coordinator|associate|analyst|intern|operations)\b|\bmarketer\b|\b(?:head|director|vp)\s+of\s+marketing\b|\bcmo\b/i, 'marketing', null],
  [/\b(?:solutions?|sales|pre-?sales|forward\s+deployed)\s+(?:engineer|architect|consultant)\b|\bfield\s+engineer\b/i, 'sales-solutions', 'solutions-engineering'],
  [/\baccount\s+executive\b|\bsales\s+executive\b/i, 'sales-solutions', 'account-executive'],
  [/\b(?:sales|business)\s+development\s+representative\b|\bsdr\b|\bbdr\b/i, 'sales-solutions', 'sales-development'],
  [/\bbusiness\s+development\b|\bpartnerships?\b|\balliances\b/i, 'sales-solutions', 'business-development'],
  [/\bsales\b/i, 'sales-solutions', null],
  [/\bit\s+(?:support|specialist|technician|helpdesk|help\s+desk|analyst)\b|\bhelp\s?desk\b|\bdesktop\s+support\b|\bservice\s+desk\b/i, 'it-support', 'help-desk'],
  [/\bsystems?\s+administrator\b|\bsysadmin\b|\bit\s+(?:administrator|manager|engineer|operations)\b|\bdata\s+cent(?:er|re)\b/i, 'it-support', 'systems-administration'],
  [/\bnetwork\s+administrator\b/i, 'it-support', 'network-administration'],
  [/\bitsm\b|\bservicenow\s+(?:administrator|admin)\b|\bit\s+service\s+management\b/i, 'it-support', 'it-service-management'],
  [/\bcustomer\s+success\b|\baccount\s+manager\b|\bclient\s+success\b/i, 'customer-success', 'customer-success-management'],
  [/\bimplementation\s+(?:manager|specialist|consultant|engineer)\b|\bonboarding\s+(?:manager|specialist)\b/i, 'customer-success', 'implementation'],
  [/\b(?:technical\s+)?support\s+engineer\b|\bproduction\s+support\b/i, 'customer-success', 'support-engineering'],
  [/\bcustomer\s+(?:support|service|experience|care)\b|\bsupport\s+(?:specialist|representative|agent|associate)\b/i, 'customer-success', 'customer-support'],
  [/\brevenue\s+operations\b|\brevops\b|\bsales\s+operations\b/i, 'operations', 'revenue-operations'],
  [/\bsupply\s+chain\b|\blogistics\b|\bprocurement\b|\bsourcing\s+manager\b/i, 'operations', 'supply-chain'],
  [/\bstrategy\s+(?:and|&)\s+operations\b|\bbiz\s*ops\b|\bbusiness\s+operations\b|\boperations\s+(?:manager|associate|analyst|lead|specialist|coordinator)\b|\bchief\s+of\s+staff\b/i, 'operations', 'business-operations'],
  [/\bstrategy\b|\bstrategist\b|\bcorporate\s+development\b/i, 'operations', 'strategy'],
  [/\bproject\s+(?:manager|coordinator)\b/i, 'operations', 'project-management'],
  [/\bpen(?:etration)?\s*tester\b|\bred\s+team(?:er)?\b|\boffensive\s+security\b|\bethical\s+hacker\b/i, 'security', 'offensive-security'],
  [/\bapplication\s+security\b|\bappsec\b|\bproduct\s+security\b/i, 'security', 'application-security'],
  [/\bdevsecops\b/i, 'security', 'devsecops'],
  [/\bsecurity\s+architect\b|\bthreat\s+model/i, 'security', 'security-architecture'],
  [/\bcloud\s+security\b|\bcontainer\s+security\b/i, 'security', 'cloud-security'],
  [/\bidentity(?:\s+(?:and|&))?\s+access\b|\biam\s+(?:engineer|analyst|architect)\b/i, 'security', 'identity-access'],
  [/\bsoc\s+analyst\b|\bsecurity\s+operations\b|\bsecurity\s+analyst\b|\bthreat\s+(?:hunter|intelligence|detection)\b|\bdetection\s+engineer\b/i, 'security', 'security-operations'],
  [/\bincident\s+response\b|\bforensic/i, 'security', 'incident-response'],
  [/\bcryptograph/i, 'security', 'cryptography'],
  [/\bmalware\b|\breverse\s+engineer|\bvulnerability\s+research/i, 'security', 'vulnerability-research'],
  [/\bprivacy\s+engineer\b|\bgrc\b/i, 'security', 'privacy-compliance'],
  [/\bsecurity\b|\bcyber\s?security\b|\binfosec\b/i, 'security', null],
  [/\bsdet\b|\bsoftware\s+(?:development\s+)?engineer\s+in\s+test\b|\btest\s+automation\b|\bautomation\s+(?:engineer|tester)\b|\bqa\s+automation\b/i, 'qa-testing', 'test-automation'],
  [/\bperformance\s+(?:test|testing|tester)\b|\bload\s+test/i, 'qa-testing', 'performance-testing'],
  [/\baccessibility\s+(?:tester|testing|analyst)\b/i, 'qa-testing', 'accessibility-testing'],
  [/\bqa\b|\bquality\s+assurance\b|\btest\s+(?:engineer|analyst|lead)\b|\btester\b|\bquality\s+engineer\b/i, 'qa-testing', 'manual-qa', true],
  [/\bmlops\b|\bllmops\b|\bml\s+(?:platform|infrastructure|ops)\b/i, 'ai-ml', 'mlops'],
  [/\bcomputer\s+vision\b|\bnlp\b|\bnatural\s+language\b|\bspeech\b|\brecommend(?:er|ation)s?\b|\bsearch\s+(?:relevance|ranking)\b|\bperception\b/i, 'ai-ml', 'applied-ml'],
  [/\bllms?\b|\bgenerative\s+ai\b|\bgen\s?ai\b|\bai\s+(?:engineer|application|product\s+engineer)\b|\bprompt\s+engineer\b|\bapplied\s+ai\b/i, 'ai-ml', 'llm-applications'],
  [/\bai\s+safety\b|\bresponsible\s+ai\b|\balignment\b/i, 'ai-ml', 'ai-safety'],
  [/\bresearch\s+(?:scientist|engineer)\b|\bai\s+research(?:er)?\b|\bml\s+research(?:er)?\b/i, 'ai-ml', 'ai-research'],
  [/\bmachine\s+learning\b|\bml\b|\bdeep\s+learning\b|\bartificial\s+intelligence\b|\bai\b/i, 'ai-ml', 'ml-engineering', true],
  [/\bdata\s+(?:engineer|engineering|platform|pipeline|infrastructure)s?\b|\betl\s+developer\b|\bbig\s+data\b/i, 'data-analytics', 'data-engineering'],
  [/\banalytics\s+engineer\b|\bbusiness\s+intelligence\b|\bbi\s+(?:developer|analyst|engineer)\b|\btableau\b|\blooker\b|\bpower\s?bi\b/i, 'data-analytics', 'analytics-engineering'],
  [/\bdata\s+scien(?:ce|tist)\b|\bstatistician\b|\bdecision\s+scientist\b/i, 'data-analytics', 'data-science'],
  [/\bdatabase\s+(?:administrator|engineer|developer|architect)\b|\bdba\b/i, 'data-analytics', 'database-engineering'],
  [/\bdata\s+governance\b|\bdata\s+steward\b|\bdata\s+quality\b/i, 'data-analytics', 'data-governance'],
  [/\bbioinformatic|\bcomputational\s+biolog/i, 'data-analytics', 'bioinformatics'],
  [/\bdata\s+analyst\b|\bproduct\s+analyst\b/i, 'data-analytics', 'data-analysis'],
  [/\banalytics\b|\bdata\b/i, 'data-analytics', 'data-analysis', true],
  [/\bsite\s+reliability\b|\bsre\b/i, 'devops-infrastructure', 'site-reliability-engineering'],
  [/\bdevops\b/i, 'devops-infrastructure', 'devops'],
  [/\bplatform\s+engineer/i, 'devops-infrastructure', 'platform-engineering'],
  [/\bcloud\s+(?:engineer|architect|infrastructure|operations)\b/i, 'devops-infrastructure', 'cloud-engineering'],
  [/\b(?:build|release)\s+engineer\b|\bbuild\s+(?:and|&)\s+release\b/i, 'devops-infrastructure', 'build-release'],
  [/\bnetwork\s+(?:engineer|architect)\b/i, 'devops-infrastructure', 'networking'],
  [/\bobservability\b|\bmonitoring\s+engineer\b/i, 'devops-infrastructure', 'observability'],
  [/\bfinops\b/i, 'devops-infrastructure', 'finops'],
  [/\bdeveloper\s+(?:experience|productivity)\b|\bdevex\b/i, 'devops-infrastructure', 'developer-experience'],
  [/\binfrastructure\b|\bkubernetes\b/i, 'devops-infrastructure', null],
  [/\bfront[\s-]?end\b|\bui\s+(?:engineer|developer)\b|\bweb\s+developer\b/i, 'software-engineering', 'frontend'],
  [/\bback[\s-]?end\b|\bapi\s+(?:engineer|developer)\b/i, 'software-engineering', 'backend'],
  [/\bfull[\s-]?stack\b/i, 'software-engineering', 'full-stack'],
  [/\bmobile\b|\bios\b|\bandroid\b|\breact\s+native\b|\bflutter\b/i, 'software-engineering', 'mobile'],
  [/\bembedded\b|\bfirmware\b/i, 'software-engineering', 'embedded'],
  [/\bgame(?:play)?\s+(?:developer|engineer|programmer)\b|\bgame\s+development\b|\bunity\s+developer\b|\bunreal\b/i, 'software-engineering', 'game-development'],
  [/\bdesktop\s+(?:application|software|engineer|developer)\b/i, 'software-engineering', 'desktop'],
  [/\bsystems\s+(?:software\s+)?(?:engineer|programmer)\b|\bkernel\b|\bcompiler\b/i, 'software-engineering', 'systems-programming'],
  [/\bblockchain\b|\bsmart\s+contracts?\b|\bweb3\b|\bsolidity\b|\bcrypto\b/i, 'software-engineering', 'blockchain'],
  [/\brobotics?\b|\bautonomous\b/i, 'software-engineering', 'robotics'],
  [/\b(?:ar|vr|xr)\b|\baugmented\s+reality\b|\bvirtual\s+reality\b|\bspatial\s+computing\b/i, 'software-engineering', 'ar-vr'],
  [/\bquantum\b/i, 'software-engineering', 'quantum'],
  [/\bhpc\b|\bhigh[\s-]performance\s+computing\b|\bgpu\s+(?:engineer|programmer)\b/i, 'software-engineering', 'hpc'],
  [/\bsalesforce\b|\bsap\b|\bservicenow\b|\bdynamics\s+365\b/i, 'software-engineering', 'enterprise-platforms'],
  [/\b(?:software|solutions?|enterprise|technical|application)\s+architect\b/i, 'software-engineering', 'software-architecture'],
  [/\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bswe\b|\bcoder\b|\bmember\s+of\s+technical\s+staff\b|\bmts\b/i, 'software-engineering', null],
];

/**
 * TailorIT's category for a job title, by rule: the first matching rule names the category, and every matching rule
 * of that category adds its subcategory ("Frontend / Mobile Engineer" -> frontend, mobile); a catch-all rule's
 * subcategory only when nothing finer matched ("Data Scientist" is Data Science, not also Data Analysis). A title no
 * rule knows is "other".
 */
export function categorizeTitle(title: string | null | undefined): {
  categoryId: JobCategoryId;
  subcategoryIds: JobSubcategoryId[];
} {
  const name = (title ?? '').replace(/\s+/g, ' ').trim();
  const first = TITLE_RULES.find(([pattern]) => pattern.test(name));
  if (!first) return { categoryId: OTHER_CATEGORY_ID, subcategoryIds: [] };
  const categoryId = first[1];
  const matching = TITLE_RULES.filter(
    ([pattern, category, subcategory]) => category === categoryId && subcategory && pattern.test(name),
  );
  const specific = matching.filter(([, , , catchAll]) => !catchAll);
  const chosen = specific.length > 0 ? specific : matching;
  const subcategoryIds: JobSubcategoryId[] = [];
  for (const [, , subcategory] of chosen) {
    if (subcategory && !subcategoryIds.includes(subcategory)) subcategoryIds.push(subcategory);
  }
  return { categoryId, subcategoryIds };
}
