import { readFileSync } from 'node:fs';
import { LETTER_FONTS, letterFontCss } from '@tailorit/shared';
import { staticDir } from '../../core/paths';

// The web fonts the letter editor offers, bundled under static/fonts (OFL woff2, latin + latin-ext; see fonts.json and
// licenses/). The print browser has no network, so letters that use them carry them inline as data: URLs; the editor
// in the browser loads the same files from GET /api/cover-letters/fonts/:file. Times New Roman, Helvetica and Courier
// are system fonts (Helvetica prints as Arial where it is missing).

interface FontFace {
  style: string;
  weight: string;
  subset: string;
  file: string;
  unicodeRange: string;
}

interface FontFamilyEntry {
  family: string;
  licence: string;
  licenceFile: string;
  faces: FontFace[];
}

let manifest: FontFamilyEntry[] | null = null;
const dataUrls = new Map<string, string>();

function families(): FontFamilyEntry[] {
  manifest ??= (JSON.parse(readFileSync(staticDir('fonts', 'fonts.json'), 'utf8')) as { families: FontFamilyEntry[] })
    .families;
  return manifest;
}

/** The bundled file names (what GET /fonts/:file may serve). */
export function isBundledFontFile(file: string): boolean {
  return /^[a-z0-9-]+\.woff2$/.test(file) && families().some((entry) => entry.faces.some((face) => face.file === file));
}

export function readFontFile(file: string): Buffer | null {
  if (!isBundledFontFile(file)) return null;
  try {
    return readFileSync(staticDir('fonts', file));
  } catch {
    return null;
  }
}

function dataUrl(file: string): string {
  let url = dataUrls.get(file);
  if (!url) {
    url = `data:font/woff2;base64,${readFileSync(staticDir('fonts', file)).toString('base64')}`;
    dataUrls.set(file, url);
  }
  return url;
}

/**
 * @font-face rules for the given families (unknown or system ones are skipped). `source` decides the src: inline
 * data: URLs (print, previews in sandboxed frames) or a URL per file (the editor).
 */
export function fontFaceCss(familyNames: Iterable<string>, source: 'data' | ((file: string) => string)): string {
  const wanted = new Set(familyNames);
  const rules: string[] = [];
  for (const entry of families()) {
    if (!wanted.has(entry.family)) continue;
    for (const face of entry.faces) {
      const src = source === 'data' ? dataUrl(face.file) : source(face.file);
      rules.push(
        `@font-face{font-family:'${entry.family}';font-style:${face.style};font-weight:${face.weight};` +
          `font-display:block;src:url(${src}) format('woff2');unicode-range:${face.unicodeRange};}`,
      );
    }
  }
  return rules.join('\n');
}

export function bundledFamilyNames(): string[] {
  return families().map((entry) => entry.family);
}

/** The bundled families a letter needs: its own font, plus any named in font-family spans of its HTML. */
export function familiesUsed(html: string, fontFamily: string): string[] {
  const bundled = new Map(bundledFamilyNames().map((name) => [name.toLowerCase(), name]));
  const used = new Set<string>();
  const add = (name: string) => {
    const hit = bundled.get(name.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase());
    if (hit) used.add(hit);
  };
  add(fontFamily);
  // Style attributes are double-quoted (sanitize-html writes them so); quotes inside are entities.
  for (const attribute of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    const style = (attribute[1] ?? '').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
    for (const declaration of style.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
      for (const part of (declaration[1] ?? '').split(',')) add(part);
    }
  }
  return [...used];
}

/** The CSS stack for a letter's font name (an unknown name falls back to Times New Roman). */
export function fontStack(name: string): string {
  return letterFontCss(name);
}

/** What DOCX names the font as (Word has no Helvetica or Courier on Windows). */
export function docxFontName(name: string): string {
  if (name === 'Helvetica') return 'Arial';
  if (name === 'Courier') return 'Courier New';
  return LETTER_FONTS.some((font) => font.name === name) ? name : 'Times New Roman';
}
