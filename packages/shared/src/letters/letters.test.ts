import { describe, expect, it } from 'vitest';
import {
  buildContactLine,
  composeLetterHtml,
  letterPlainText,
  letterVariableValues,
  salutationFor,
  splitName,
  textToHtmlParagraphs,
} from './compose';
import {
  DEFAULT_LETTER_FONT,
  LETTER_FONTS,
  defaultLetterTitle,
  defaultTemplateName,
  duplicateTemplateName,
  letterFontCss,
  replacePlaceholderHint,
  templatePreviewText,
  validateLetterTitle,
  validateTemplateName,
} from './constants';
import {
  CreateLetterTemplateBodySchema,
  GenerateCoverLetterBodySchema,
  PatchCoverLetterBodySchema,
  PatchLetterTemplateBodySchema,
} from './dto';
import {
  LETTER_VARIABLES,
  VARIABLE_GROUP_LABEL,
  VARIABLE_PATTERN,
  aiVariablesIn,
  findPlaceholders,
  isAiVariable,
  isVariableName,
  listVariables,
  normalizePlaceholders,
  replaceAllPlaceholder,
  substituteVariables,
  variableDefinition,
  variablesByGroup,
} from './variables';

describe('variable registry', () => {
  it('has the four groups with Simplify-style names', () => {
    expect(Object.values(VARIABLE_GROUP_LABEL)).toEqual(['Profile', 'Dynamic', 'Structural', 'AI Generated']);
    expect(variablesByGroup().map((group) => [group.label, group.variables.length])).toEqual([
      ['Profile', 9],
      ['Dynamic', 4],
      ['Structural', 3],
      ['AI Generated', 6],
    ]);
  });

  it('gives every variable a label, one sentence and a valid name', () => {
    expect(new Set(LETTER_VARIABLES.map((variable) => variable.name)).size).toBe(LETTER_VARIABLES.length);
    for (const variable of LETTER_VARIABLES) {
      expect(isVariableName(variable.name), variable.name).toBe(true);
      expect(variable.label.length).toBeGreaterThan(0);
      expect(variable.description.trim().endsWith('.'), variable.name).toBe(true);
    }
    expect(variableDefinition('HIRING_MANAGER')?.defaultValue).toBe('Hiring Manager');
    expect(variableDefinition('SALUTATION')?.defaultValue).toBe('Dear Hiring Manager,');
    expect(variableDefinition('SIGN_OFF')?.defaultValue).toBe('Sincerely,');
    expect(variableDefinition('NOPE')).toBeNull();
  });

  it('knows the AI variables', () => {
    expect(isAiVariable('COMPANY_APPEAL')).toBe(true);
    expect(isAiVariable('COMPANY_NAME')).toBe(false);
    expect(isAiVariable('UNKNOWN')).toBe(false);
  });
});

describe('placeholders', () => {
  const template =
    '<p>Dear Team at {{COMPANY_NAME}},</p><p>{{COMPANY_APPEAL}}</p><p>{ {SKILL_HIGHLIGHT} } and {{ COMPANY_NAME }}</p><p>{{lower}} {{MY_OWN}}</p>';

  it('normalizes loose spellings', () => {
    expect(normalizePlaceholders('{ {X} } {{ Y_2 }} { { Z } }')).toBe('{{X}} {{Y_2}} {{Z}}');
  });

  it('finds names once each in order, unknown ones included', () => {
    expect(findPlaceholders(template)).toEqual(['COMPANY_NAME', 'COMPANY_APPEAL', 'SKILL_HIGHLIGHT', 'MY_OWN']);
    expect(aiVariablesIn(template)).toEqual(['COMPANY_APPEAL', 'SKILL_HIGHLIGHT']);
  });

  it('lists variables with counts and definitions', () => {
    expect(listVariables(template).map((use) => [use.name, use.count, use.definition?.group ?? null])).toEqual([
      ['COMPANY_NAME', 2, 'dynamic'],
      ['COMPANY_APPEAL', 1, 'ai'],
      ['SKILL_HIGHLIGHT', 1, 'ai'],
      ['MY_OWN', 1, null],
    ]);
  });

  it('exports a pattern safe to reuse with matchAll', () => {
    const text = '{{A}} {{B}}';
    expect([...text.matchAll(VARIABLE_PATTERN)].length).toBe(2);
    expect([...text.matchAll(VARIABLE_PATTERN)].length).toBe(2);
  });
});

describe('substituteVariables', () => {
  it('fills known values, escaping them, and leaves the rest literal', () => {
    const html = '<p>Dear {{HIRING_MANAGER}} at {{COMPANY_NAME}}, re {{JOB_TITLE}}. {{UNSET}} {{BLANK}}</p>';
    expect(
      substituteVariables(html, {
        HIRING_MANAGER: 'Ann <b>Lee</b>',
        COMPANY_NAME: 'AT&T "Labs"',
        JOB_TITLE: undefined,
        BLANK: '   ',
      }),
    ).toBe('<p>Dear Ann &lt;b&gt;Lee&lt;/b&gt; at AT&amp;T &quot;Labs&quot;, re {{JOB_TITLE}}. {{UNSET}} {{BLANK}}</p>');
  });

  it('turns a multi-paragraph value that fills its own paragraph into paragraphs', () => {
    const html = '<p class="x">{{COVER_LETTER_BODY}}</p><p>Inline: {{ROLE_FIT}}</p>';
    expect(substituteVariables(html, { COVER_LETTER_BODY: 'First.\n\nSecond.', ROLE_FIT: 'One\ntwo\n\nthree' })).toBe(
      '<p class="x">First.</p><p class="x">Second.</p><p>Inline: One<br>two<br><br>three</p>',
    );
  });

  it('never reads a filled-in value as a variable', () => {
    const values = { COVER_LETTER_BODY: 'I love {{COMPANY_NAME}}.\n\nThanks.', COMPANY_NAME: 'Acme', A: 'x\n\n{{A}}' };
    expect(substituteVariables('<p>{{COVER_LETTER_BODY}}</p>', values)).toBe(
      '<p>I love {{COMPANY_NAME}}.</p><p>Thanks.</p>',
    );
    expect(substituteVariables('<p>{{A}}</p>', values)).toBe('<p>x</p><p>{{A}}</p>');
    expect(substituteVariables('{{CONSTRUCTOR}} {{__PROTO__}}', {})).toBe('{{CONSTRUCTOR}} {{__PROTO__}}');
  });

  it('stays fast on unclosed paragraph tags', () => {
    const started = Date.now();
    substituteVariables('<p '.repeat(70_000), { X: 'y' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads loose spellings and replaces every copy', () => {
    expect(replaceAllPlaceholder('{{X_1}} and { {X_1} } but {{Y}}', 'X_1', 'Acme & Co')).toBe(
      'Acme &amp; Co and Acme &amp; Co but {{Y}}',
    );
    expect(replaceAllPlaceholder('{{X}}', 'X', '')).toBe('{{X}}');
  });
});

describe('letter constants', () => {
  it('lists the ten fonts with Times New Roman as the default', () => {
    expect(LETTER_FONTS.map((font) => font.name)).toEqual([
      'Times New Roman',
      'Helvetica',
      'Courier',
      'Open Sans',
      'Roboto',
      'Lato',
      'Poppins',
      'Arimo',
      'Work Sans',
      'Roboto Mono',
    ]);
    expect(DEFAULT_LETTER_FONT).toBe('Times New Roman');
    expect(letterFontCss('Work Sans')).toBe('"Work Sans", sans-serif');
    expect(letterFontCss('Comic Sans')).toBe('"Times New Roman", Times, serif');
  });

  it('names new letters and templates', () => {
    expect(defaultLetterTitle(new Date(2026, 9, 22, 9))).toBe('Cover Letter 10/22/2026');
    expect(defaultTemplateName(new Date(2026, 9, 22, 15, 4, 5))).toBe('Template 10/22/2026, 3:04:05 PM');
    expect(duplicateTemplateName('Classic Professional')).toBe('Classic Professional (Copy)');
  });

  it('previews templates in 80 characters', () => {
    expect(templatePreviewText('Short  and\nsweet')).toBe('Short and sweet');
    const long = 'a'.repeat(100);
    expect(templatePreviewText(long)).toBe(`${'a'.repeat(80)}...`);
    expect(templatePreviewText('b'.repeat(80))).toBe('b'.repeat(80));
  });

  it('validates names', () => {
    expect(validateTemplateName('ab')).toBe('Template name must be at least 3 characters long');
    expect(validateTemplateName('  abc ')).toBeNull();
    expect(validateTemplateName('x'.repeat(201))).toMatch(/at most 200/);
    expect(validateLetterTitle('Hi')).toBe('Cover letter name must be at least 3 characters long');
    expect(replacePlaceholderHint('COMPANY_NAME')).toBe(
      'All tags named {{COMPANY_NAME}} will become the text you enter below.',
    );
  });
});

describe('composition', () => {
  const profile = {
    fullName: 'Jordan Avery Chen',
    email: 'jordan@example.com',
    phone: '+1 555 123 4567',
    location: 'San Francisco, CA',
    linkedin: 'linkedin.com/in/jordan',
    portfolio: '',
    title: 'Senior Engineer',
  };

  it('splits names and builds the contact line', () => {
    expect(splitName('Jordan Avery Chen')).toEqual({ first: 'Jordan', last: 'Chen' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(buildContactLine({ phone: '1', email: '', linkedin: 'li' })).toBe('1 | li');
    expect(salutationFor(' Ms. Lee ')).toBe('Dear Ms. Lee,');
    expect(salutationFor(null)).toBe('Dear Hiring Manager,');
  });

  it('fills every deterministic variable and leaves out empty ones', () => {
    const values = letterVariableValues({
      profile,
      job: { companyName: 'Acme', jobTitle: 'Platform Engineer' },
      today: new Date(2026, 9, 22),
    });
    expect(values).toMatchObject({
      USER_FULL_NAME: 'Jordan Avery Chen',
      USER_FIRST_NAME: 'Jordan',
      USER_LAST_NAME: 'Chen',
      COMPANY_NAME: 'Acme',
      HIRING_MANAGER: 'Hiring Manager',
      TODAY_DATE: 'October 22, 2026',
      SALUTATION: 'Dear Hiring Manager,',
      SIGN_OFF: 'Sincerely,',
      CONTACT_LINE: '+1 555 123 4567 | jordan@example.com | linkedin.com/in/jordan',
    });
    expect(values).not.toHaveProperty('USER_PORTFOLIO');
    expect(substituteVariables('<p>{{USER_PORTFOLIO}}</p>', values)).toBe('<p>{{USER_PORTFOLIO}}</p>');
  });

  it('wraps generated paragraphs in the Simplify layout', () => {
    expect(
      composeLetterHtml({ name: 'Jordan Chen', contactLine: '1 | j@x.io', paragraphs: ['I build <things>.', ' ', 'I ship.'] }),
    ).toBe(
      '<h1 style="text-align: center">Jordan Chen</h1><p style="text-align: center">1 | j@x.io</p>' +
        '<p>Dear Hiring Manager,</p><p>I build &lt;things&gt;.</p><p>I ship.</p><p>Sincerely,</p><p>Jordan Chen</p>',
    );
  });

  it('turns uploaded text into paragraphs and back', () => {
    const html = textToHtmlParagraphs('Dear { {COMPANY_NAME} } team,\r\n\r\nLine one\nline two\n\n\n');
    expect(html).toBe('<p>Dear {{COMPANY_NAME}} team,</p><p>Line one<br>line two</p>');
    expect(letterPlainText(html)).toBe('Dear {{COMPANY_NAME}} team,\nLine one\nline two');
  });
});

describe('letter contracts', () => {
  it('validates the generate body', () => {
    expect(GenerateCoverLetterBodySchema.parse({ companyName: 'Acme', jobTitle: 'SRE' })).toEqual({
      companyName: 'Acme',
      jobTitle: 'SRE',
      jobDescription: '',
      templateId: null,
      customPrompt: '',
    });
    expect(GenerateCoverLetterBodySchema.safeParse({ companyName: '', jobTitle: 'SRE' }).success).toBe(false);
  });

  it('enforces the name rule and the prompt limit', () => {
    const tooShort = PatchLetterTemplateBodySchema.safeParse({ name: 'ab' });
    expect(tooShort.success).toBe(false);
    expect(tooShort.error?.issues[0]?.message).toBe('Template name must be at least 3 characters long');
    expect(PatchLetterTemplateBodySchema.safeParse({ aiPrompt: 'x'.repeat(1001) }).success).toBe(false);
    expect(CreateLetterTemplateBodySchema.parse({})).toEqual({});
    expect(PatchCoverLetterBodySchema.safeParse({ fontFamily: 'Comic Sans' }).success).toBe(false);
    expect(PatchCoverLetterBodySchema.parse({ fontFamily: 'Lato' })).toEqual({ fontFamily: 'Lato' });
  });
});
