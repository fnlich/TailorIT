import { describe, expect, it } from 'vitest';
import { previewParts, templatePreviewBlocks } from './previewBlocks';

describe('previewParts', () => {
  it('keeps text and variables apart, in order', () => {
    expect(previewParts('Dear {{COMPANY_NAME}} team,')).toEqual([{ text: 'Dear ' }, { variable: 'COMPANY_NAME' }, { text: ' team,' }]);
    expect(previewParts('{{A}}{{B_2}}')).toEqual([{ variable: 'A' }, { variable: 'B_2' }]);
    expect(previewParts('{{lower}} stays text')).toEqual([{ text: '{{lower}} stays text' }]);
    expect(previewParts('')).toEqual([]);
  });
});

describe('templatePreviewBlocks', () => {
  it('reads a stored template: headings, alignment, paragraphs and chips', () => {
    const html =
      '<h1 style="text-align: center">{{USER_FULL_NAME}}</h1><p style="text-align: center">{{CONTACT_LINE}}</p>' +
      '<p>I am applying for the {{JOB_TITLE}} position at {{COMPANY_NAME}}.</p><p>Thank you &amp; regards,</p>';
    expect(templatePreviewBlocks(html)).toEqual([
      { kind: 'heading', align: 'center', parts: [{ variable: 'USER_FULL_NAME' }] },
      { kind: 'text', align: 'center', parts: [{ variable: 'CONTACT_LINE' }] },
      {
        kind: 'text',
        align: 'left',
        parts: [{ text: 'I am applying for the ' }, { variable: 'JOB_TITLE' }, { text: ' position at ' }, { variable: 'COMPANY_NAME' }, { text: '.' }],
      },
      { kind: 'text', align: 'left', parts: [{ text: 'Thank you & regards,' }] },
    ]);
  });

  it('keeps one empty line between paragraphs and drops them at the edges', () => {
    const blocks = templatePreviewBlocks('<p></p><p>One</p><p></p><p></p><p>Two</p><p></p>');
    expect(blocks.map((block) => block.parts)).toEqual([[{ text: 'One' }], [], [{ text: 'Two' }]]);
  });

  it('reads list items once (their inner paragraph is not a second line) and splits <br> lines', () => {
    expect(templatePreviewBlocks('<ul><li><p>First</p></li><li><p>Second</p></li></ul><p>a<br>b</p>')).toEqual([
      { kind: 'item', align: 'left', parts: [{ text: 'First' }] },
      { kind: 'item', align: 'left', parts: [{ text: 'Second' }] },
      { kind: 'text', align: 'left', parts: [{ text: 'a' }] },
      { kind: 'text', align: 'left', parts: [{ text: 'b' }] },
    ]);
  });

  it('reads plain text without block tags, and nothing as nothing', () => {
    expect(templatePreviewBlocks('Hello {{COMPANY_NAME}}\nBye')).toEqual([
      { kind: 'text', align: 'left', parts: [{ text: 'Hello ' }, { variable: 'COMPANY_NAME' }] },
      { kind: 'text', align: 'left', parts: [{ text: 'Bye' }] },
    ]);
    expect(templatePreviewBlocks('')).toEqual([]);
    expect(templatePreviewBlocks('<p></p>')).toEqual([]);
  });
});
