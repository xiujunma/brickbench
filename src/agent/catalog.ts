import { COLORS, getColor, type ColorFinish } from '../core/colors';
import type { Finder, FinderFilters } from '../core/parts/finder/finder';
import { colourInQuery } from '../core/parts/finder/colourWords';
import type { PartDef } from '../core/parts/types';

/** A part as agents see it: w along x and d along z in studs (before turning), h in plates. */
export interface PartInfo {
  readonly part: string;
  readonly name: string;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

export function partInfo(part: PartDef): PartInfo {
  return { part: part.id, name: part.name, w: part.w, d: part.d, h: part.h };
}

/**
 * A palette colour from an LDraw code (4), a code written as text ("4") or a
 * name ("Dark Bluish Gray", "red", "clear"); null when it names none.
 */
export function resolveColour(ref: number | string): number | null {
  if (typeof ref === 'number') return getColor(ref) ? ref : null;
  const text = ref.trim();
  if (/^\d+$/.test(text)) return resolveColour(Number(text));
  const { colorId, rest } = colourInQuery(text);
  return colorId !== null && rest === '' ? colorId : null;
}

export function colourName(id: number): string {
  return getColor(id)?.name ?? `colour ${id}`;
}

export function paletteList(): { readonly id: number; readonly name: string; readonly finish: ColorFinish }[] {
  return COLORS.map((c) => ({ id: c.id, name: c.name, finish: c.finish }));
}

/** A part found by find_parts: its sizes, and its canonical part pattern (P[oooo]{2}=3020), whose [ ] is its top face. */
export interface FoundPart extends PartInfo {
  readonly source: string;
  readonly pattern?: string;
}

/** Parts matching a search by words or by part pattern, best first, with their sizes and patterns. */
export function searchParts(
  finder: Finder,
  query: string,
  limit: number,
  filters: FinderFilters = {},
): { readonly parts: FoundPart[]; readonly total: number } {
  const { items } = finder.find(query, filters);
  const parts = items.slice(0, limit).map((item): FoundPart => {
    const pattern = finder.patternOf(item.partId);
    const found = { part: item.partId, name: item.name, w: item.w, d: item.d, h: item.h, source: item.source };
    return pattern === undefined ? found : { ...found, pattern };
  });
  return { parts, total: items.length };
}
