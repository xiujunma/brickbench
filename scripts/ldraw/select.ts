/** What a part file says about itself in its header lines. */
export interface PartHeader {
  readonly description: string;
  /** From !LDRAW_ORG: Part, Shortcut, Subpart, Primitive… */
  readonly kind: string;
  readonly category: string;
  readonly keywords: readonly string[];
  /** Real name from the Author line, or the user name when that is all it gives. */
  readonly author: string;
}

/** "0 Author: Jane Doe [jdoe]" → "Jane Doe"; "0 Author: [jdoe]" → "jdoe". */
function authorName(line: string): string {
  const match = /^0 Author:\s*(.*?)\s*(?:\[([^\]]*)\])?\s*$/.exec(line);
  return (match?.[1] || match?.[2] || '').trim();
}

/** Reads the header of an LDraw part file. */
export function readHeader(text: string): PartHeader {
  const lines = text.split(/\r?\n/, 40).map((line) => line.trim());
  const description = lines[0]?.startsWith('0 ') ? lines[0].slice(2).trim() : '';
  let kind = '';
  let category = '';
  let author = '';
  const keywords: string[] = [];
  for (const line of lines) {
    if (line.startsWith('0 !LDRAW_ORG ')) kind = line.split(/\s+/)[2] ?? '';
    else if (line.startsWith('0 Author:')) author = authorName(line);
    else if (line.startsWith('0 !CATEGORY ')) category = line.slice('0 !CATEGORY '.length).trim();
    else if (line.startsWith('0 !KEYWORDS ')) {
      keywords.push(...line.slice('0 !KEYWORDS '.length).split(',').map((k) => k.trim()).filter(Boolean));
    }
  }
  if (!category) category = description.replace(/^[~=_|]+/, '').split(/\s+/)[0] ?? '';
  return { description, kind, category, keywords, author };
}

/** Why a part is left out of the library, or null to keep it. */
export function exclusionReason(header: PartHeader): string | null {
  const { description } = header;
  if (description.startsWith('~')) return 'obsolete';
  if (description.startsWith('=')) return 'alias';
  if (description.startsWith('_')) return 'colour variant';
  // LDraw marks parts from other makers (Hubelino, Rotacaster…) with a leading bar
  if (description.startsWith('|')) return 'third-party';
  if (/\b(Pattern|Sticker|Stickers)\b/i.test(description)) return 'printed';
  if (header.kind !== 'Part' && header.kind !== 'Shortcut') return 'not a part';
  return null;
}

/** "Brick  2 x  4" → "Brick 2 × 4". */
export function displayName(description: string): string {
  return description
    .replace(/\s+/g, ' ')
    .replace(/(\d) x (?=\d)/g, '$1 × ')
    .trim();
}
