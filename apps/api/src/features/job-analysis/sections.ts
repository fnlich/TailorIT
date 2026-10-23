import { decodeHtmlEntities } from '@tailorit/shared';

// The "About the job" summary read straight off a posting: its Requirements, Responsibilities and Desired
// Qualifications, found by their headings and the list items (or short lines) under them. Pure string work over the
// sanitized HTML ingestion stores, or over plain text (free_tailor's lake keeps postings as pasted text).

export const SECTION_KINDS = ['requirements', 'responsibilities', 'desired'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface PostingSections {
  requirements: string[];
  responsibilities: string[];
  desired: string[];
}

export const emptySections = (): PostingSections => ({ requirements: [], responsibilities: [], desired: [] });

/** Bullets per section, and characters per bullet, kept for display. */
export const MAX_SECTION_ITEMS = 15;
export const MAX_ITEM_LENGTH = 400;

const APOSTROPHE = "['’]";

/** Headings that name none of the three sections, checked first ("About us", "Benefits", "How to apply"). */
const IGNORED = new RegExp(
  [
    String.raw`\bbenefits?\b`,
    String.raw`\bperks\b`,
    String.raw`\bwhat we offer\b`,
    String.raw`\bwe offer\b`,
    String.raw`\bcompensation\b`,
    String.raw`\bsalary\b`,
    String.raw`\bpay (?:range|transparency)\b`,
    String.raw`\bequal (?:opportunity|employment)\b`,
    String.raw`\beeo\b`,
    String.raw`\babout (?:us|the company|the team|our)\b`,
    String.raw`\blife at\b`,
    String.raw`\bour values\b`,
    String.raw`\bwhy (?:join|work)\b`,
    String.raw`\bhow to apply\b`,
    String.raw`\bhiring process\b`,
    String.raw`\binterview process\b`,
    String.raw`\bprivacy\b`,
    String.raw`\bwho we are\b`,
    String.raw`\btechnologies we use\b`,
    String.raw`\bour (?:tech )?stack\b`,
    String.raw`\btech stack\b`,
    String.raw`\blocation\b`,
    String.raw`\bsupports? full[\s-]time\b`,
  ].join('|'),
  'i',
);

const DESIRED = new RegExp(
  [
    String.raw`\bnice[\s-]to[\s-]haves?\b`,
    String.raw`\bpreferred\b`,
    String.raw`\bbonus(?: points)?\b`,
    String.raw`\bpluses\b`,
    String.raw`\ba plus\b`,
    String.raw`\bdesired\b`,
    String.raw`\bdesirable\b`,
    String.raw`\bgood[\s-]to[\s-]have\b`,
    String.raw`\bextra credit\b`,
    String.raw`\bwould be (?:great|nice|a plus|helpful)\b`,
    String.raw`\bideally\b`,
    String.raw`\bstand out\b`,
    String.raw`\badditional (?:qualifications|skills)\b`,
    String.raw`\bwhat we value\b`,
    String.raw`\beven better\b`,
    String.raw`\bnot required\b`,
  ].join('|'),
  'i',
);

const REQUIREMENTS = new RegExp(
  [
    String.raw`\brequire(?:ment|ments|d)?\b`,
    String.raw`\bqualifications?\b`,
    String.raw`\bwhat you${APOSTROPHE}?(?:ll| will)? (?:need|bring|have)\b`,
    String.raw`\bwhat we${APOSTROPHE}?(?:re| are) looking for\b`,
    String.raw`\bwho you are\b`,
    String.raw`\babout you\b`,
    String.raw`\byou (?:have|bring|are|should have|might be|may be)\b`,
    String.raw`\bmust[\s-]haves?\b`,
    String.raw`\bskills\b`,
    String.raw`\bexperience\b`,
    String.raw`\bwhat we need\b`,
    String.raw`\bminimum\b`,
    String.raw`\bcompetenc`,
    String.raw`\byour (?:profile|background|skills|experience)\b`,
    String.raw`\bideal candidate\b`,
    String.raw`\bto be successful\b`,
    String.raw`\bgood fit\b`,
    String.raw`\bwe${APOSTROPHE}?(?:d| would) love\b`,
  ].join('|'),
  'i',
);

const RESPONSIBILITIES = new RegExp(
  [
    String.raw`\bresponsib`,
    String.raw`\bwhat you${APOSTROPHE}?(?:ll| will) (?:do|work on|be doing|own|achieve|build)\b`,
    String.raw`\bwhat (?:the|this) (?:role|job|position) (?:involves|entails|looks like)\b`,
    String.raw`\b(?:the|your|this) role\b`,
    String.raw`\bin this (?:role|position)\b`,
    String.raw`\bday[\s-]to[\s-]day\b`,
    String.raw`\bduties\b`,
    String.raw`\b(?:your|the) impact\b`,
    String.raw`\bkey accountabilit`,
    String.raw`\byou${APOSTROPHE}?(?:ll| will)\b`,
    String.raw`\bthe work\b`,
    String.raw`\byour mission\b`,
    String.raw`\bthe opportunity\b`,
    String.raw`\b(?:role )?overview\b`,
    String.raw`\bwhat you can expect\b`,
    String.raw`^(?:role\s+)?focus(?:\s+areas)?$`,
    String.raw`\bwhat you${APOSTROPHE}?ll be\b`,
  ].join('|'),
  'i',
);

/**
 * Whether a short line reads as a heading at all: one of the three sections, or a known other one ("Benefits",
 * "About us") that ends the section before it.
 */
function isKnownHeading(text: string): boolean {
  return classifyHeading(text) !== null || IGNORED.test(text);
}

/** Which section a heading names, or null ("About us", "Benefits", a team's name). */
export function classifyHeading(heading: string): SectionKind | null {
  const text = heading.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120) return null;
  if (DESIRED.test(text)) return 'desired';
  if (IGNORED.test(text)) return null;
  if (REQUIREMENTS.test(text)) return 'requirements';
  if (RESPONSIBILITIES.test(text)) return 'responsibilities';
  return null;
}

type Block = { type: 'heading' | 'item' | 'para'; text: string };

const BULLET_MARK = /^\s*(?:[•·●▪◦‣►✓✔]\s*|[-*–—](?=\s)\s*|o\s+|\(?\d{1,2}[.)](?=\s)\s*)/;

/** A bullet's display text: marks and spacing tidied, a dangling list separator dropped, capped. */
export function cleanItem(text: string): string {
  let item = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  item = item.replace(BULLET_MARK, '').replace(/[;,]$/, '').trim();
  if (item.length > MAX_ITEM_LENGTH) {
    const cut = item.slice(0, MAX_ITEM_LENGTH);
    const space = cut.lastIndexOf(' ');
    item = `${(space > MAX_ITEM_LENGTH * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
  }
  return item;
}

function addItems(target: string[], items: Iterable<string>): void {
  for (const raw of items) {
    if (target.length >= MAX_SECTION_ITEMS) return;
    const item = cleanItem(raw);
    if (item.length < 3 || /^[\p{P}\s]+$/u.test(item)) continue;
    if (!target.some((existing) => existing.toLowerCase() === item.toLowerCase())) target.push(item);
  }
}

/** The blocks of sanitized HTML, in order: headings (h1-h6, a paragraph that is all bold), list items, paragraphs. */
function htmlBlocks(html: string): Block[] {
  const marked = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // <p><strong>Requirements:</strong></p> and <div><b><span>The Role</span></b></div> read as headings.
    .replace(
      /<(p|div)\b[^>]*>\s*(?:<(?:span|u|em|i)\b[^>]*>\s*)*<(strong|b)\b[^>]*>((?:(?!<\/?(?:strong|b)\b)[\s\S])*?)<\/\2\s*>\s*(?:<\/(?:span|u|em|i)\s*>\s*)*:?\s*(?:<br\s*\/?>\s*)*<\/\1\s*>/gi,
      (_whole, _tag, _bold, inner: string) => `\n\u0001H${inner.replace(/<[^>]*>/g, ' ')}\n`,
    )
    // "<p><strong>Requirements</strong><br>- a<br>- b</p>": a bold lead followed by a line break is a heading too.
    .replace(/<(strong|b)\b[^>]*>([^<]{2,80})<\/\1\s*>\s*:?\s*<br\s*\/?>/gi, (_whole, _tag, inner: string) => `\n\u0001H${inner}\n`)
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (_whole, inner: string) => `\n\u0001H${inner.replace(/<[^>]*>/g, ' ')}\n`)
    .replace(/<li\b[^>]*>/gi, '\n\u0001L')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|ul|ol|table|tr|blockquote|section|article|header|footer|pre)\s*>/gi, '\n')
    .replace(/<(?:p|div|ul|ol|table|tr|blockquote|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const blocks: Block[] = [];
  for (const rawLine of decodeHtmlEntities(marked).split('\n')) {
    const line = rawLine.replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').trim();
    if (!line) continue;
    if (line.startsWith('\u0001H')) {
      const text = line.slice(2).trim();
      if (text) blocks.push({ type: 'heading', text });
    } else if (line.startsWith('\u0001L')) {
      const text = line.slice(2).trim();
      if (text) blocks.push({ type: 'item', text });
    } else {
      blocks.push(lineBlock(line));
    }
  }
  return blocks;
}

/** Words that make a short line read as a list item ("Experience with AWS"), not a heading ("Experience"). */
const ITEM_WORDS = /\b(?:with|in|of|for|using|on|at|from|including)\b|\d/i;

/** Whole lines that are always headings, whatever words they hold ("What We're Looking For", "Nice to Have"). */
const HEADING_LINE = new RegExp(
  String.raw`^(?:(?:key|core|main|primary|your|the|job|basic|minimum|required|preferred|desired|additional|technical|essential|ideal)\s+)*` +
    String.raw`(?:responsibilities|requirements|qualifications?|duties|skills(?:\s*(?:&|and)\s*(?:experience|qualifications|abilities))?|` +
    String.raw`experience|nice[\s-]to[\s-]haves?|bonus(?:\s+points)?|what\s+you(?:${APOSTROPHE}ll|\s+will)?\s+(?:do|bring|need|have)|` +
    String.raw`what\s+(?:we|you)(?:${APOSTROPHE}re|\s+are)\s+looking\s+for|who\s+we${APOSTROPHE}?re\s+looking\s+for|who\s+you\s+are|about\s+you|` +
    String.raw`(?:the|your)\s+role|role\s+overview|focus|outcomes|what\s+we\s+offer|benefits|perks|tech\s+stack)\s*:?$`,
  'i',
);

/**
 * A plain line: a bullet; a heading (short and ending with ":", a line that is a section name, or a few capitalised
 * words that name a section, such as "Requirements" or "What You'll Bring"); otherwise a paragraph.
 */
function lineBlock(line: string): Block {
  if (BULLET_MARK.test(line) && line.replace(BULLET_MARK, '').trim().length > 0) {
    return { type: 'item', text: line.replace(BULLET_MARK, '').trim() };
  }
  const words = line.split(/\s+/).length;
  if (line.length <= 80 && words <= 10 && /:\s*$/.test(line)) return { type: 'heading', text: line.replace(/:\s*$/, '') };
  // "Bonus: Performance-based annual bonus" is a label and its value, never a heading.
  if (/^[^:]{1,50}:\s+\S/.test(line)) return { type: 'para', text: line };
  if (line.length <= 80 && words <= 10 && /\?\s*$/.test(line) && isKnownHeading(line.replace(/\?\s*$/, ''))) {
    return { type: 'heading', text: line.replace(/\?\s*$/, '') };
  }
  if (line.length <= 60 && HEADING_LINE.test(line)) return { type: 'heading', text: line };
  if (words <= 6 && /^\p{Lu}/u.test(line) && !/[.!?]["”’)]?$/.test(line) && !ITEM_WORDS.test(line) && isKnownHeading(line)) {
    return { type: 'heading', text: line };
  }
  return { type: 'para', text: line };
}

function textBlocks(text: string): Block[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .map(lineBlock);
}

/** Closing boilerplate that ends a run of lines (an EEO or privacy statement), whatever its length. */
const BOILERPLATE =
  /\bequal (?:opportunity|employment)\b|\beeo\b|\ball qualified applicants\b|\breasonable accommodations?\b|\bprivacy (?:policy|notice)\b|\bwithout regard to\b/i;

/**
 * Paragraphs that can stand as bullets when a section has no list ("Requirements:" followed by lines): the short ones
 * up to the first boilerplate statement or the first long prose after the list, when there are at least two.
 */
function paragraphItems(paragraphs: string[]): string[] {
  const items: string[] = [];
  for (const paragraph of paragraphs) {
    if (BOILERPLATE.test(paragraph)) break;
    if (paragraph.length > 300) {
      if (items.length >= 2) break;
      continue;
    }
    items.push(paragraph);
  }
  return items.length >= 2 ? items : [];
}

function sectionsOfBlocks(blocks: Block[]): PostingSections {
  const out = emptySections();
  let current: SectionKind | null = null;
  let items: string[] = [];
  let paragraphs: string[] = [];
  const flush = () => {
    if (current) addItems(out[current], items.length > 0 ? items : paragraphItems(paragraphs));
    items = [];
    paragraphs = [];
  };
  for (const block of blocks) {
    if (block.type === 'heading') {
      flush();
      current = classifyHeading(block.text);
    } else if (block.type === 'item') {
      // "• Required Qualifications:" or "What we expect from you?" in a list is a sub-heading, not a bullet.
      const asHeading = /[:?]\s*$/.test(block.text) && block.text.length <= 80 ? classifyHeading(block.text.replace(/[:?]\s*$/, '')) : null;
      if (asHeading) {
        flush();
        current = asHeading;
      } else {
        items.push(block.text);
      }
    } else if (current) {
      // A paragraph that introduces a list ("You will:") inside a section belongs to it; long prose is skipped.
      paragraphs.push(block.text);
    }
  }
  flush();
  return out;
}

const hasAny = (sections: PostingSections) =>
  sections.requirements.length > 0 || sections.responsibilities.length > 0 || sections.desired.length > 0;

/**
 * The three sections of a posting's sanitized HTML, or of its text when the HTML yields none. `preferText` reads the
 * text first: a posting that was plain text to begin with (its HTML was made from it) keeps its blank lines there.
 */
export function extractSections(html: string, text?: string | null, options: { preferText?: boolean } = {}): PostingSections {
  const fromText = () => (text?.trim() ? sectionsOfBlocks(textBlocks(text)) : emptySections());
  const fromHtml = () => (html.trim() ? sectionsOfBlocks(htmlBlocks(html)) : emptySections());
  const first = options.preferText ? fromText() : fromHtml();
  return hasAny(first) ? first : options.preferText ? fromHtml() : fromText();
}

/** Items of an HTML list fragment (Lever's `lists[].content`: "<li>a</li><li>b</li>"). */
export function listItemsOf(html: string): string[] {
  const items: string[] = [];
  for (const block of htmlBlocks(html)) if (block.type === 'item' || block.type === 'para') items.push(block.text);
  return items;
}

/**
 * Structured lists (heading + items, as Lever sends them) as sections. A list whose heading names no section is the
 * role's work when it comes first and nothing else is ("Administrative Business Partner (Foundry)": its duties).
 */
export function sectionsOfLists(lists: ReadonlyArray<{ heading: string; items: string[] }>): PostingSections {
  const out = emptySections();
  const kinds = lists.map((list) => classifyHeading(list.heading));
  if (kinds.length > 0 && kinds[0] === null && !kinds.includes('responsibilities')) {
    const heading = lists[0]!.heading;
    // A heading that is itself a question or an aside ("Some examples of ...") is not the role's duties.
    if (!/\?|example|technolog|stack|tools/i.test(heading)) kinds[0] = 'responsibilities';
  }
  lists.forEach((list, index) => {
    const kind = kinds[index];
    if (kind) addItems(out[kind], list.items);
  });
  return out;
}

/** Section lists merged: `primary` wins section by section, `fallback` fills the empty ones. */
export function mergeSections(primary: PostingSections, fallback: PostingSections): PostingSections {
  return {
    requirements: primary.requirements.length ? primary.requirements : fallback.requirements,
    responsibilities: primary.responsibilities.length ? primary.responsibilities : fallback.responsibilities,
    desired: primary.desired.length ? primary.desired : fallback.desired,
  };
}
