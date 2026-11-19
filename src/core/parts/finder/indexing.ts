import type { LDrawIndexEntry } from '../../ldraw/format';
import type { PartDef } from '../types';
import { featuresOf, footprintKey, heightClassOf, nicknamesOf, PRINTED_TAG, type Feature, type HeightClass } from './tags';
import { normalizeForSearch } from './text';

export type PartSource = 'basic' | 'library';

/** A part as the finder knows it, built-in or from the LDraw library. */
export interface FinderItem {
  readonly partId: string;
  readonly name: string;
  /** LDraw part number, e.g. "3001"; empty if there is none. */
  readonly number: string;
  readonly source: PartSource;
  /** Built-in category id ("bricks") or LDraw category ("Brick"). */
  readonly category: string;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly author?: string | undefined;
  /** A printed or stickered library part. */
  readonly printed?: boolean | undefined;
}

/** A part prepared for searching and filtering. */
export interface Indexed {
  readonly item: FinderItem;
  readonly order: number;
  /** Library part already offered as a built-in one. */
  readonly duplicate: boolean;
  readonly name: string;
  /** Everything a query may match: name, number, category, keywords and nicknames. */
  readonly haystack: string;
  /** Nicknames and built-in keywords, whole: a query that is one of them names the part. */
  readonly tags: ReadonlySet<string>;
  readonly features: ReadonlySet<Feature>;
  readonly footprint: string;
  readonly height: HeightClass | null;
}

/** The part of a name before its attachments: "plate 1x1 with clip" → "plate 1x1". */
function mainName(name: string): string {
  return name.split(/ (?:with|for|and) /)[0] ?? name;
}

/**
 * The size a part is sold as ("Plate 1 × 1 with Clip" is 1 × 1 though its
 * clip takes a second cell). A size bigger than the part itself is something
 * else, such as a wheel rim's millimetres, so the cells it takes win then.
 */
export function nominalFootprint(name: string, w: number, d: number): string {
  const size = /(?:^|\s)(\d+)x(\d+)(?![\d.])/.exec(mainName(name));
  const [a, b] = [Number(size?.[1]), Number(size?.[2])];
  const fits = size !== null && Math.min(a, b) <= Math.min(w, d) + 1 && Math.max(a, b) <= Math.max(w, d) + 1;
  return fits ? footprintKey(a, b) : footprintKey(w, d);
}

/**
 * The height a part is sold as: plates and tiles one plate, bricks three per
 * brick, or the height the name gives ("Brick 1 × 2 × 2" is six). Trusted
 * only near the real height, so a "Tile 2 × 2 Roadsign Base" stays tall.
 */
export function nominalPlates(name: string, plates: number): number {
  const match = /^(plate|tile|brick) \d+x\d+(?:x(\d+(?:\.\d+)?))?(?![\d.])/.exec(name);
  if (!match) return plates;
  const bricks = match[2] !== undefined ? Number(match[2]) : match[1] === 'brick' ? 1 : 1 / 3;
  const nominal = Math.max(1, Math.round(bricks * 3));
  return Math.abs(nominal - plates) <= 1 ? nominal : plates;
}

export function indexItem(item: FinderItem, keywords: readonly string[], order: number, duplicate: boolean): Indexed {
  const name = normalizeForSearch(item.name);
  const nicknames = nicknamesOf(name);
  // library ids ("ldraw:3001") stay out: every library part would match "draw"
  const id = item.source === 'basic' ? item.partId : '';
  const extra = normalizeForSearch([item.number, id, item.category, ...keywords].join(' '));
  // LDraw's community keywords are too loose to name a part; ours are chosen
  const naming = item.source === 'basic' ? keywords.map(normalizeForSearch) : [];
  return {
    item,
    order,
    duplicate,
    name,
    haystack: [name, extra, ...nicknames].join(' '),
    // "printed" names every print, but only as a whole word: in the text, "ted" would find ten thousand parts
    tags: new Set([...nicknames, ...naming, ...(item.printed ? [PRINTED_TAG] : [])]),
    features: featuresOf(name),
    footprint: nominalFootprint(name, item.w, item.d),
    height: heightClassOf(nominalPlates(name, item.h)),
  };
}

export function builtInItem(part: PartDef): FinderItem {
  const number = part.ldraw?.file.replace(/\.dat$/, '') ?? '';
  return { partId: part.id, name: part.name, number, source: 'basic', category: part.category, w: part.w, d: part.d, h: part.h };
}

export function libraryItem(entry: LDrawIndexEntry): FinderItem {
  return {
    partId: `ldraw:${entry.id}`,
    name: entry.name,
    number: entry.id,
    source: 'library',
    category: entry.category,
    w: entry.w,
    d: entry.d,
    h: entry.h,
    author: entry.author,
    ...(entry.printed ? { printed: true } : {}),
  };
}
