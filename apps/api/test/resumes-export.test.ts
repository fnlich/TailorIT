import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { afterEach, describe, expect, it } from 'vitest';
import { RESUME_EXPORT_FORMAT, readResumeImport } from '@tailorit/shared';
import { getPdfService } from '../src/core/pdf/index';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

// Downloads of a built resume: JSON (read back by Import JSON), "Word (simple layout)" and the PDF (Chrome, when one
// is installed: skipped otherwise).

let ctx: TestContext | null = null;
// Taken first, so a slow Chrome close (seconds on a loaded machine) can never clean up the next test's context.
afterEach(async () => {
  const current = ctx;
  ctx = null;
  if (!current) return;
  await getPdfService(current.deps).close();
  current.cleanup();
}, 30_000);

const DOCUMENT = {
  name: 'Odile Brannstrom',
  title: 'Site Reliability Engineer',
  contact: { email: 'odile.b@example.com', phone: '+1 555 0142', location: 'Boston, MA', linkedin: 'linkedin.com/in/odile-example' },
  summary: 'Keeps the pagers quiet.',
  skills: ['Go', 'Kubernetes', 'Prometheus', 'Terraform'],
  softSkills: ['Incident command'],
  experience: [
    {
      title: 'SRE',
      company: 'Saltmarsh Analytics',
      startDate: '2019',
      endDate: 'Present',
      location: 'Boston',
      description: '',
      achievements: ['Cut pages per week from 40 to 6'],
    },
  ],
  education: [{ degree: 'B.S. Physics', institution: 'Harborview College', startDate: '2011', endDate: '2015' }],
  projects: [{ name: 'promlint', description: 'Lints alert rules.' }],
  preferredTemplate: 'classic-serif',
};

async function setup(): Promise<{ agent: TestAgent; id: string }> {
  ctx = createTestContext();
  const { agent } = await signIn(ctx, 'exporter@example.com');
  const res = await agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: DOCUMENT });
  return { agent, id: res.body.id as string };
}

async function pdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.total };
  } finally {
    await parser.destroy();
  }
}

describe('export', () => {
  it('JSON: the TailorIT file Import JSON reads back', async () => {
    const { agent, id } = await setup();
    const res = await agent.get(`/api/resumes/${id}/export?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toContain('filename="Site_Reliability_Engineer.json"');
    expect(res.body).toMatchObject({ format: RESUME_EXPORT_FORMAT, version: 1, templateId: 'classic-serif', title: null });
    const read = readResumeImport(res.body);
    expect(read.ok && read.resumes[0]!.document.name).toBe('Odile Brannstrom');
  });

  it('DOCX: one simple layout, readable by Word tools', async () => {
    const { agent, id } = await setup();
    const res = await agent.get(`/api/resumes/${id}/export?format=docx`).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('Site_Reliability_Engineer.docx');
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = (await mammoth.extractRawText({ buffer })).value;
    expect(text).toContain('Odile Brannstrom');
    expect(text).toContain('PROFESSIONAL EXPERIENCE');
    expect(text).toContain('Cut pages per week from 40 to 6');
    expect(text).toContain('promlint');
    expect(text).not.toContain('Incident command');
  });

  it('PDF: the template printed on A4 by Chrome (skipped without a browser)', async (test) => {
    const { agent, id } = await setup();
    if (!getPdfService(ctx!.deps).available()) {
      test.skip();
      return;
    }
    const res = await agent.get(`/api/resumes/${id}/export?format=pdf`).responseType('blob');
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Site_Reliability_Engineer.pdf');
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text, pages } = await pdfText(buffer);
    expect(text).toContain('Odile Brannstrom');
    expect(text).toContain('Saltmarsh Analytics');
    expect(pages).toBe(1);
  });

  it('refuses an unknown format, and the original-file route for a built resume', async () => {
    const { agent, id } = await setup();
    const unknown = await agent.get(`/api/resumes/${id}/export?format=odt`);
    // An unknown format reads as absent: the default (PDF) or, without Chrome, a 503 saying so.
    expect([200, 503]).toContain(unknown.status);
    const file = await agent.get(`/api/resumes/${id}/file`);
    expect(file.status).toBe(404);
    expect(file.body.error.message).toMatch(/built in TailorIT/);
  });
});
