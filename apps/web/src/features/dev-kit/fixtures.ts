import type { Account } from '@tailorit/shared/auth';

/*
 * Fake data for the dev kit page (/dev/kit): no API needed. Times are relative to a fixed clock so the wording
 * matches Simplify's screenshot ("3 days ago", "1 day ago", "3 hours ago").
 */

export const KIT_NOW = Date.parse('2026-10-23T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(KIT_NOW - ms).toISOString();

export const KIT_ACCOUNT: Account = {
  id: 'kit-user',
  email: 'david.jack@example.com',
  name: 'David Jack',
  avatarUrl: null,
  role: 'admin',
  defaultResumeId: 'r1',
  createdAt: ago(30 * DAY),
};

export interface KitResume {
  id: string;
  title: string;
  personName: string;
  kind: 'built' | 'uploaded';
  format?: 'PDF' | 'DOCX';
  template: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
}

export const KIT_RESUMES: KitResume[] = [
  {
    id: 'r1',
    title: 'David_Jack_resume',
    personName: 'David Jack',
    kind: 'uploaded',
    format: 'PDF',
    template: '',
    isDefault: true,
    createdAt: ago(3 * DAY),
    updatedAt: ago(1 * DAY),
    lastEditedAt: ago(1 * DAY),
  },
  {
    id: 'r2',
    title: 'PaaS Infrastructure Engineering Cloud Automation &Tools Consultant',
    personName: 'David Jack',
    kind: 'built',
    template: 'Modern',
    isDefault: false,
    createdAt: ago(1 * DAY),
    updatedAt: ago(3 * HOUR),
    lastEditedAt: ago(3 * HOUR),
  },
  {
    id: 'r3',
    title: 'David_Jack_resume',
    personName: 'David Jack',
    kind: 'built',
    template: 'Classic',
    isDefault: false,
    createdAt: ago(2 * DAY),
    updatedAt: ago(2 * DAY),
    lastEditedAt: ago(2 * DAY),
  },
  {
    id: 'r4',
    title: 'David_Jack_resume',
    personName: 'David Jack',
    kind: 'built',
    template: 'Compact',
    isDefault: false,
    createdAt: ago(2 * DAY + 5 * HOUR),
    updatedAt: ago(2 * DAY + 5 * HOUR),
    lastEditedAt: ago(2 * DAY + 5 * HOUR),
  },
];

export interface KitLetter {
  id: string;
  title: string;
  origin: 'generated' | 'uploaded';
  company: string;
  jobTitle: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
}

export const KIT_LETTERS: KitLetter[] = [
  {
    id: 'l1',
    title: 'Cover Letter 10/22/2026',
    origin: 'generated',
    company: 'Tesla',
    jobTitle: 'Lead Site Reliability Engineer',
    createdAt: ago(2 * HOUR),
    updatedAt: ago(2 * HOUR),
    lastEditedAt: null,
  },
  {
    id: 'l2',
    title: 'Cover Letter 10/21/2026',
    origin: 'generated',
    company: 'Anthropic',
    jobTitle: 'Staff Software Engineer',
    createdAt: ago(1 * DAY),
    updatedAt: ago(1 * DAY),
    lastEditedAt: null,
  },
  {
    id: 'l3',
    title: 'Cover Letter 10/20/2026',
    origin: 'uploaded',
    company: 'Visa',
    jobTitle: 'Software Developer',
    createdAt: ago(2 * DAY),
    updatedAt: ago(2 * DAY),
    lastEditedAt: null,
  },
];

const PAGE_CSS =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
  '<style>html,body{margin:0;background:#fff;color:#1a1a1a}body{box-sizing:border-box}</style>';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

/** A US Letter page that looks like a generated letter (Simplify's wrapper: centred name, contact line, body). */
export function kitLetterPage(letter: KitLetter): string {
  const p = (text: string) => `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`;
  return `<!doctype html><html><head>${PAGE_CSS}</head><body style="width:816px;min-height:1056px;padding:72px 84px;font:15px/1.5 'Times New Roman',serif">
<h1 style="margin:0;text-align:center;font-size:26px">David Jack</h1>
<p style="margin:6px 0 30px;text-align:center;font-size:13px;color:#444">(555) 010-0199 | david.jack@example.com | linkedin.com/in/davidjack</p>
${p('Dear Hiring Manager,')}
${p(`I am excited to apply for the ${letter.jobTitle} role at ${letter.company}. For the past eight years I have kept large production systems calm under pressure, and I would love to bring that steadiness to your team.`)}
${p('At my current company I rebuilt our on-call rotation around clear runbooks and alerting that pages for symptoms rather than causes. Pages dropped by half within a quarter, and the engineers who carry the pager now sleep through most nights.')}
${p('I also enjoy the quieter work: reading a slow trace until the real bottleneck shows itself, or pairing with a newer teammate on their first incident review.')}
${p(`What draws me to ${letter.company} is the scale of the problems and the care the team puts into getting them right. I would be glad to talk about how I can help.`)}
${p('Sincerely,')}
<p style="margin:0">David Jack</p>
</body></html>`;
}

/** An A4 page that looks like a resume. */
export function kitResumePage(resume: KitResume): string {
  const bar = (width: number) =>
    `<div style="height:9px;margin:7px 0;background:#e9e9e9;border-radius:4px;width:${width}%"></div>`;
  const section = (title: string, rows: number[]) =>
    `<h2 style="margin:26px 0 8px;font:700 15px/1 Arial,sans-serif;letter-spacing:.08em;color:#0b6b80;text-transform:uppercase;border-bottom:2px solid #0b6b80;padding-bottom:6px">${title}</h2>${rows.map(bar).join('')}`;
  return `<!doctype html><html><head>${PAGE_CSS}</head><body style="width:794px;min-height:1123px;padding:56px 60px;font:14px/1.4 Arial,sans-serif">
<h1 style="margin:0;font-size:34px;letter-spacing:-.01em">${escapeHtml(resume.personName)}</h1>
<p style="margin:6px 0 0;font-size:16px;color:#0b6b80;font-weight:700">${escapeHtml(resume.title.replace(/_/g, ' '))}</p>
<p style="margin:8px 0 0;font-size:12px;color:#555">david.jack@example.com · (555) 010-0199 · San Francisco, CA</p>
${section('Summary', [96, 92, 70])}
${section('Experience', [60, 94, 90, 88, 52, 60, 95, 85, 40])}
${section('Education', [55, 40])}
${section('Skills', [90, 75])}
</body></html>`;
}

/** Pretends to fetch a thumbnail (as GET /api/…/preview would). */
export function fakeFetch(html: string, delayMs = 350): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve(html), delayMs));
}
