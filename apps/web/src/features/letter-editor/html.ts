import { htmlToText } from '@tailorit/shared/format';
import { letterFontCss, LETTER_FONTS, type LetterFontName } from '@tailorit/shared/letters';

/*
 * Pure helpers between stored letter/template HTML and the TipTap editor. Stored HTML holds variables as the literal
 * text `{{NAME}}`; the editor shows them as chips, so they are wrapped as `<span data-variable="NAME">` before the
 * editor parses the HTML (and the chip serialises back to the plain text).
 */

const VARIABLE_IN_TEXT = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** `{{NAME}}` in text (never inside a tag or an attribute) wrapped as a variable span the editor reads as a chip. */
export function toEditorHtml(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith('<') ? part : part.replace(VARIABLE_IN_TEXT, (_whole, name: string) => `<span data-variable="${name}"></span>`),
    )
    .join('');
}

/** The editor's HTML as stored: every chip (`<span data-variable="NAME">{{NAME}}</span>`) back to `{{NAME}}`. */
export function fromEditorHtml(html: string): string {
  return html.replace(/<span data-variable="([A-Z][A-Z0-9_]*)">\{\{\1\}\}<\/span>/g, '{{$1}}');
}

/** An editor's current content as stored HTML. */
export function storedHtmlOf(editor: { getHTML(): string }): string {
  return fromEditorHtml(editor.getHTML());
}

/** True when the HTML has no visible text (an empty editor is `<p></p>`). Variables count as text. */
export function isEmptyLetterHtml(html: string | null | undefined): boolean {
  return htmlToText(html ?? '').trim() === '';
}

export function isLetterFont(name: string | null | undefined): name is LetterFontName {
  return LETTER_FONTS.some((font) => font.name === name);
}

/** The editor's paper font stack for a letter font name. */
export function paperFontStack(name: string | null | undefined): string {
  return letterFontCss(name);
}

/** The font name a CSS stack set by the editor's font-family marks belongs to (null when it is none of ours). */
export function fontNameOfStack(stack: string | null | undefined): LetterFontName | null {
  if (!stack) return null;
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase();
  const match = LETTER_FONTS.find(
    (font) => font.css === stack || font.name.toLowerCase() === first || font.css.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase() === first,
  );
  return match?.name ?? null;
}

/** "Ctrl+B" / "⌘B": the modifier names the reader's keyboard uses. */
export function shortcutLabel(keys: string, isMac: boolean): string {
  if (!isMac) return keys.replace(/Mod/g, 'Ctrl');
  return keys
    .replace(/Mod\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧');
}
