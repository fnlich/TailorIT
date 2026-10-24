// The fake model's `resume_analysis` answer, read off the resume text between the prompt's markers, so the dev
// server and the tests see each upload read for its own skills, roles and dates. Plain Node ESM, no dependencies
// (see README.md for the ctx shape).
//
// - personName: the first line, when it reads as a name.
// - roles: the headline among the first lines, then the title on (or just above) each date range.
// - hardSkills, softSkills, certifications, industries: the terms of the small lists below the text names, spelled as
//   the text spells them.
// - experience: each date range with its title; totalYearsExperience: an "N+ years of experience" the text states.
// - Like a real model now and then, it also slips in things the resume never says: a hard skill, a soft skill, a
//   role, a certification, an industry, a role with years the text does not have, and a total of years when the text
//   states none. TailorIT's grounding (apps/api/src/features/resumes/analysis/prompt.ts) must drop them all.

const HARD = [
  ['Go', true], ['Python'], ['Java'], ['JavaScript'], ['TypeScript'], ['Rust', true], ['C++'], ['C#'], ['Kotlin'],
  ['SQL'], ['React'], ['Node.js'], ['Django'], ['GraphQL'], ['Kubernetes'], ['K8s'], ['Docker'], ['Terraform'],
  ['Linux'], ['PostgreSQL'], ['Postgres'], ['MySQL'], ['MongoDB'], ['Redis'], ['Kafka'], ['Spark', true],
  ['Airflow'], ['Snowflake', true], ['AWS'], ['GCP'], ['Azure'], ['gRPC'], ['CI/CD'], ['Git', true], ['Figma'],
  ['Jira'], ['Tableau'], ['pandas'], ['PyTorch'], ['TensorFlow'],
];
const SOFT = [
  'communication', 'mentoring', 'leadership', 'collaboration', 'stakeholder management', 'problem solving', 'teamwork',
  'ownership', 'adaptability',
];
const CERTIFICATIONS = [
  'Certified Kubernetes Administrator', 'CKA', 'AWS Certified Solutions Architect', 'AWS Certified Developer', 'PMP',
  'CISSP', 'Certified ScrumMaster',
];
const INDUSTRIES = ['fintech', 'payments', 'banking', 'healthcare', 'e-commerce', 'logistics', 'insurance', 'gaming'];
const TITLE_NOUNS =
  /\b(?:engineer|developer|manager|designer|analyst|scientist|architect|consultant|lead|director|intern|specialist)\b/i;

/** What the fake makes up, every time. */
export const INVENTED = {
  hardSkill: 'Quantum knitting',
  softSkill: 'Telepathy',
  role: 'Chief Happiness Astronaut',
  certification: 'Certified Dragon Tamer',
  industry: 'Space mining',
  experienceTitle: 'Lunar Base Commander',
  totalYears: 37,
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (term, caseSensitive = false) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}+#])`, `u${caseSensitive ? '' : 'i'}`);

/** The spellings the text uses for each listed term it names. */
function found(text, terms) {
  const out = [];
  for (const entry of terms) {
    const [term, caseSensitive] = Array.isArray(entry) ? entry : [entry, false];
    const match = wordPattern(term, caseSensitive).exec(text);
    if (match) out.push(match[0].replace(/\s+/g, ' '));
  }
  return out;
}

const DATE = String.raw`(?:\d{1,2}/\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4})`;
const RANGE = new RegExp(String.raw`(${DATE})\s*(?:-|\u2013|\u2014|to)\s*(${DATE}|Present|Current)`, 'i');

/** A title from a line: the text before the first separator or date, when it names a title noun. */
function titleOf(line) {
  const head = line.replace(RANGE, ' | ').split(/\s+(?:at|@)\s+|\s*[|,(]\s*|\s+[-\u2013\u2014]\s+/)[0].trim();
  return head && head.split(/\s+/).length <= 8 && TITLE_NOUNS.test(head) ? head : null;
}

/** A year from 1960 on that the text never writes (for the role the fake makes up). */
function yearNotIn(text) {
  for (let year = 1960; year < 2000; year += 1) if (!text.includes(String(year))) return year;
  return 1901;
}

export default function resumeAnalysis({ user }) {
  const open = user.indexOf('<<<RESUME\n');
  const close = user.lastIndexOf('\nRESUME>>>');
  const text = open >= 0 && close > open ? user.slice(open + '<<<RESUME\n'.length, close) : '';
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const first = lines[0] ?? '';
  const personName = /^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,3}$/u.test(first) ? first : null;

  const roles = [];
  for (const line of lines.slice(1, 6)) {
    const title = !RANGE.test(line) ? titleOf(line) : null;
    if (title) {
      roles.push(title);
      break;
    }
  }
  const experience = [];
  lines.forEach((line, index) => {
    const range = RANGE.exec(line);
    if (!range) return;
    const title = titleOf(line) ?? (index > 0 ? titleOf(lines[index - 1]) : null);
    if (!title) return;
    if (!roles.some((role) => role.toLowerCase() === title.toLowerCase())) roles.push(title);
    experience.push({ title, company: '', startDate: range[1], endDate: range[2] });
  });

  const total = /(\d{1,2})\+?\s+years?\s+of\s+(?:professional\s+)?experience/i.exec(text);
  const invented = yearNotIn(text);

  return {
    personName,
    roles: [...roles, INVENTED.role],
    hardSkills: [...found(text, HARD), INVENTED.hardSkill],
    softSkills: [...found(text, SOFT), INVENTED.softSkill],
    certifications: [...found(text, CERTIFICATIONS), INVENTED.certification],
    industries: [...found(text, INDUSTRIES), INVENTED.industry, 'Gaming'],
    experience: [
      ...experience,
      { title: INVENTED.experienceTitle, company: 'Moonbase Alpha', startDate: `01/${invented}`, endDate: `12/${invented + 2}` },
    ],
    totalYearsExperience: total ? Number(total[1]) : INVENTED.totalYears,
  };
}
