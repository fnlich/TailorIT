// The page a template prints on, read from its own `@page` rule. Chrome obeys a document's `@page` margins over
// the ones `page.pdf()` is given, so these are what the PDF really uses; the preview is built from the same box,
// which is why a preview resembles its PDF. The PDF is always A4: a template asking for another size is laid out at
// that size and shrunk onto A4, centred, and the preview mirrors that (`mediaScale`).

/** CSS absolute lengths in px at 96 dpi. */
const PX_PER_UNIT: Readonly<Record<string, number>> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};

/** Named `@page size` keywords, in px at 96 dpi. */
const NAMED_PAGE_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  a3: { width: 1123, height: 1587 },
  a4: { width: 794, height: 1123 },
  a5: { width: 559, height: 794 },
  letter: { width: 816, height: 1056 },
  legal: { width: 816, height: 1344 },
  tabloid: { width: 1056, height: 1632 },
  ledger: { width: 1632, height: 1056 },
};

export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/** The margins `page.pdf()` is given; they apply only to a template with no `@page` margin of its own. */
export const FALLBACK_PAGE_MARGIN = { top: '0.4in', right: '0.5in', bottom: '0.3in', left: '0.5in' } as const;

export interface PageMargin {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface TemplatePageBox {
  /** The page the document is laid out on (its `@page size`). */
  pageWidthPx: number;
  pageHeightPx: number;
  /** As CSS lengths, from its `@page margin`. */
  margin: PageMargin;
  /** Page minus margins. */
  contentWidthPx: number;
  contentHeightPx: number;
  /** The shrink onto the A4 sheet, and the vertical offset that centres it; 1 and 0 for an A4 template. */
  mediaScale: number;
  mediaOffsetYPx: number;
  /** The CSS uses viewport units, whose basis differs off the page. */
  usesViewportUnits: boolean;
}

function lengthPx(value: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z]*)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const factor = PX_PER_UNIT[(match[2] || 'px').toLowerCase()];
  return factor === undefined ? null : amount * factor;
}

/** The declarations of every `@page` rule, in source order (later ones win), nested at-rules dropped. */
function atPageDeclarations(css: string): string[] {
  const bodies: string[] = [];
  const opener = /@page\b[^{]*\{/gi;
  for (let rule = opener.exec(css); rule; rule = opener.exec(css)) {
    const bodyStart = opener.lastIndex;
    let cursor = bodyStart;
    let depth = 1;
    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      cursor += 1;
    }
    bodies.push(css.slice(bodyStart, Math.max(cursor - 1, bodyStart)).replace(/[^;{}]*\{[^{}]*\}/g, ''));
    opener.lastIndex = cursor;
  }
  return bodies
    .join(';')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean);
}

function marginSides(value: string): [string, string, string, string] | null {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return null;
  const top = parts[0]!;
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}

function pageSize(value: string, current: { width: number; height: number }): { width: number; height: number } {
  let size = current;
  let orientation: 'portrait' | 'landscape' | null = null;
  const lengths: number[] = [];
  for (const token of value.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (token === 'auto') continue;
    if (token === 'portrait' || token === 'landscape') {
      orientation = token;
      continue;
    }
    const named = NAMED_PAGE_SIZES[token];
    if (named) {
      size = named;
      continue;
    }
    const length = lengthPx(token);
    if (length !== null && length > 0) lengths.push(length);
  }
  if (lengths.length === 1) size = { width: lengths[0]!, height: lengths[0]! };
  else if (lengths.length >= 2) size = { width: lengths[0]!, height: lengths[1]! };
  if (orientation === 'landscape' && size.height > size.width) size = { width: size.height, height: size.width };
  else if (orientation === 'portrait' && size.width > size.height) size = { width: size.height, height: size.width };
  return size;
}

/** The page box a template prints into, from the `@page` rules in its markup and stylesheet. */
export function resolvePageBox(template: { htmlContent?: string; cssContent?: string }): TemplatePageBox {
  const css = `${template.cssContent ?? ''}\n${template.htmlContent ?? ''}`;
  const margin: PageMargin = { ...FALLBACK_PAGE_MARGIN };
  let size = { width: A4_WIDTH_PX, height: A4_HEIGHT_PX };

  for (const declaration of atPageDeclarations(css)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value) continue;
    if (property === 'size') size = pageSize(value, size);
    else if (property === 'margin') {
      const sides = marginSides(value);
      if (sides) [margin.top, margin.right, margin.bottom, margin.left] = sides;
    } else if (property === 'margin-top') margin.top = value;
    else if (property === 'margin-right') margin.right = value;
    else if (property === 'margin-bottom') margin.bottom = value;
    else if (property === 'margin-left') margin.left = value;
  }

  const px = (value: string, fallback: string) => lengthPx(value) ?? lengthPx(fallback) ?? 0;
  const top = px(margin.top, FALLBACK_PAGE_MARGIN.top);
  const right = px(margin.right, FALLBACK_PAGE_MARGIN.right);
  const bottom = px(margin.bottom, FALLBACK_PAGE_MARGIN.bottom);
  const left = px(margin.left, FALLBACK_PAGE_MARGIN.left);
  const mediaScale = Math.min(1, A4_WIDTH_PX / size.width, A4_HEIGHT_PX / size.height);

  return {
    pageWidthPx: size.width,
    pageHeightPx: size.height,
    margin,
    contentWidthPx: Math.max(1, size.width - left - right),
    contentHeightPx: Math.max(1, size.height - top - bottom),
    mediaScale,
    mediaOffsetYPx: (A4_HEIGHT_PX - size.height * mediaScale) / 2,
    usesViewportUnits: /\b\d*\.?\d+(vh|vw|vmin|vmax)\b/i.test(css),
  };
}

/** The sheet a preview frame is sized to, and where page breaks fall in it. */
export function previewPage(box: TemplatePageBox): { widthPx: number; heightPx: number; contentHeightPx: number } {
  const shrunk = box.mediaScale !== 1;
  return {
    widthPx: Math.round(shrunk ? A4_WIDTH_PX : box.pageWidthPx),
    heightPx: Math.round(shrunk ? A4_HEIGHT_PX : box.pageHeightPx),
    contentHeightPx: Math.round(box.contentHeightPx * box.mediaScale),
  };
}
