import { describe, expect, it } from 'vitest';
import { fileNameFromDisposition } from './download';

describe('fileNameFromDisposition', () => {
  it('prefers the UTF-8 name', () => {
    expect(
      fileNameFromDisposition(`attachment; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20letter.pdf`),
    ).toBe('Résumé letter.pdf');
  });

  it('reads the plain name, or nothing', () => {
    expect(fileNameFromDisposition('attachment; filename="Cover Letter 10-22-2026.pdf"')).toBe('Cover Letter 10-22-2026.pdf');
    expect(fileNameFromDisposition('attachment; filename=letter.docx')).toBe('letter.docx');
    expect(fileNameFromDisposition('attachment')).toBeNull();
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});
