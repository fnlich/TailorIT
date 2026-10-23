import { describe, expect, it } from 'vitest';
import { fileNameFromDisposition, fileSizeRefusal, isPdfFile, pdfRefusal } from './files';

describe('upload checks', () => {
  it('knows a PDF by its type or its extension', () => {
    expect(isPdfFile({ name: 'cv.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'cv', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'cv.docx', type: 'application/msword' })).toBe(false);
  });

  it('refuses a file of 5 MB or more with a sentence naming it', () => {
    expect(fileSizeRefusal({ name: 'cv.pdf', size: 5 * 1024 * 1024 })).toBe(
      'cv.pdf is 5 MB or larger; files under 5 MB are accepted. Choose a smaller file.',
    );
    expect(fileSizeRefusal({ name: 'cv.pdf', size: 1024 })).toBeNull();
  });

  it('refuses a non-PDF for the PDF import', () => {
    expect(pdfRefusal({ name: 'cv.docx', type: '', size: 10 })).toBe('Please upload a PDF file.');
    expect(pdfRefusal({ name: 'cv.pdf', type: 'application/pdf', size: 10 })).toBeNull();
  });
});

describe('fileNameFromDisposition', () => {
  it('prefers the UTF-8 name and falls back to the plain one', () => {
    expect(fileNameFromDisposition(`attachment; filename="Ann_Lee.pdf"; filename*=UTF-8''Ann%20Lee%20%C3%A9.pdf`)).toBe('Ann Lee é.pdf');
    expect(fileNameFromDisposition('attachment; filename="Ann_Lee.docx"')).toBe('Ann_Lee.docx');
    expect(fileNameFromDisposition('attachment; filename=plain.json')).toBe('plain.json');
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition('inline')).toBeNull();
  });
});
