import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { resumeExportFile, resumeExportFileName, type ResumeDocument, type ResumeExportFormat } from '@tailorit/shared';
import { renderResumeDocxHtml, renderResumePrintHtml } from '@tailorit/render';
import { nowIso, type AppDeps } from '../../core/context';
import { MIME_BY_KIND } from '../../core/files/index';
import { AppError } from '../../core/http/errors';
import { getPdfService } from '../../core/pdf/index';
import { getResumeEngine } from './engine';

// Downloads of a built resume: the PDF (the template printed by Chrome, JavaScript off and the network shut), the
// "Word (simple layout)" DOCX, and the JSON file Import JSON reads back.

export interface ExportedFile {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

/** One inch, in twentieths of a point (html-to-docx margins). */
const INCH_TWIPS = 1440;

async function docxBuffer(html: string, title: string): Promise<Buffer> {
  const result = await HTMLtoDOCX(html, null, {
    orientation: 'portrait',
    margins: { top: INCH_TWIPS / 2, right: INCH_TWIPS / 2, bottom: INCH_TWIPS / 2, left: INCH_TWIPS / 2 },
    title,
    subject: 'Resume, Word (simple layout)',
    creator: 'TailorIT',
    font: 'Arial',
    fontSize: 20,
  });
  if (Buffer.isBuffer(result)) return result;
  if (result instanceof ArrayBuffer) return Buffer.from(result);
  return Buffer.from(await (result as Blob).arrayBuffer());
}

export async function exportBuiltResume(
  deps: AppDeps,
  userId: string,
  resume: { label: string; title: string | null; templateId: string | null; document: ResumeDocument },
  format: ResumeExportFormat,
): Promise<ExportedFile> {
  const engine = getResumeEngine(deps);
  const skills = engine.skillsFor(userId);
  if (format === 'json') {
    const file = resumeExportFile({ title: resume.title, templateId: resume.templateId, document: resume.document }, nowIso(deps));
    return {
      buffer: Buffer.from(`${JSON.stringify(file, null, 2)}\n`),
      mime: 'application/json; charset=utf-8',
      fileName: resumeExportFileName(resume.label, 'json'),
    };
  }
  if (format === 'docx') {
    const template = engine.templates.resolve(null, resume.document.preferredTemplate);
    if (!template) throw new AppError('internal', 'No resume template is available on this server.');
    const html = renderResumeDocxHtml(resume.document, template, skills);
    return { buffer: await docxBuffer(html, resume.label), mime: MIME_BY_KIND.docx, fileName: resumeExportFileName(resume.label, 'docx') };
  }
  const printed = renderResumePrintHtml({ document: resume.document, templates: engine.templates, skills });
  // A4, as free_tailor prints: Chrome takes the template's own @page margins (the fallback only applies to a
  // template without one) and shrinks a page of another size onto A4.
  const buffer = await getPdfService(deps).printPdf(printed.html, {
    format: 'A4',
    margin: printed.pageBox.margin,
    preferCSSPageSize: false,
    printBackground: true,
  });
  return { buffer, mime: MIME_BY_KIND.pdf, fileName: resumeExportFileName(resume.label, 'pdf') };
}
