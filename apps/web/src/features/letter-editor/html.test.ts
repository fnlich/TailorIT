import { describe, expect, it } from 'vitest';
import { fontNameOfStack, fromEditorHtml, isEmptyLetterHtml, shortcutLabel, toEditorHtml } from './html';

describe('letter editor HTML', () => {
  it('wraps variables in text as chips, never inside tags', () => {
    expect(toEditorHtml('<p>Dear {{HIRING_MANAGER}}, at {{COMPANY_NAME}}.</p>')).toBe(
      '<p>Dear <span data-variable="HIRING_MANAGER"></span>, at <span data-variable="COMPANY_NAME"></span>.</p>',
    );
    expect(toEditorHtml('<a href="https://x.test/{{X}}">{{X}}</a>')).toBe(
      '<a href="https://x.test/{{X}}"><span data-variable="X"></span></a>',
    );
    expect(toEditorHtml('<p>{{lower}} {{ SPACED }} {{OK_1}}</p>')).toBe('<p>{{lower}} {{ SPACED }} <span data-variable="OK_1"></span></p>');
  });

  it('turns chips back into stored {{NAME}} text', () => {
    expect(fromEditorHtml('<p>Hi <strong><span data-variable="USER_FIRST_NAME">{{USER_FIRST_NAME}}</span></strong>!</p>')).toBe(
      '<p>Hi <strong>{{USER_FIRST_NAME}}</strong>!</p>',
    );
    // Only well-formed chips (name and text agree) are unwrapped.
    expect(fromEditorHtml('<span data-variable="A">{{B}}</span>')).toBe('<span data-variable="A">{{B}}</span>');
  });

  it('knows an empty letter', () => {
    expect(isEmptyLetterHtml('')).toBe(true);
    expect(isEmptyLetterHtml('<p></p><p> </p>')).toBe(true);
    expect(isEmptyLetterHtml('<p>{{COMPANY_NAME}}</p>')).toBe(false);
  });

  it('maps CSS stacks back to font names', () => {
    expect(fontNameOfStack('"Open Sans", sans-serif')).toBe('Open Sans');
    expect(fontNameOfStack('Lato, sans-serif')).toBe('Lato');
    expect(fontNameOfStack('Comic Sans MS')).toBeNull();
    expect(fontNameOfStack(null)).toBeNull();
  });

  it('labels shortcuts for the platform', () => {
    expect(shortcutLabel('Mod+Shift+L', false)).toBe('Ctrl+Shift+L');
    expect(shortcutLabel('Mod+Alt+1', true)).toBe('⌘⌥1');
  });
});
