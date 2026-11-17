/**
 * The user's own parts, as agents see them: each part and colour from the
 * parts lists of their sets, with how many the model uses and how many are
 * left, so an agent asked to build from what the user has can stay within it.
 */
import { getColor } from '../core/colors';
import { partNumberOf } from '../core/inventory/match';
import { lotKey, ownedCounts, partIdFor, usedCounts, type Counts, type OwnedList } from '../core/inventory/stock';
import { LDRAW_PREFIX } from '../core/ldraw/catalogIndex';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { colourName, partInfo, type PartInfo } from './catalog';

export const NO_LISTS_NOTE =
  'The user has not added the parts lists of any sets they own. They can add them in BrickBench under File → Your parts; until then, build with any parts.';

/** A part and colour the user owns, with how many the model uses and how many are left. */
export interface OwnedLot extends PartInfo {
  readonly color: number;
  readonly color_name: string;
  readonly owned: number;
  readonly used: number;
  /** Below zero when the model uses more than the user has. */
  readonly left: number;
}

/** Owned and used counts for the user's lists and a model. */
export interface Tally {
  readonly owned: Counts;
  readonly used: Counts;
}

export function tally(lists: readonly OwnedList[], bricks: readonly Brick[], lookup: PartLookup): Tally {
  return { owned: ownedCounts(lists), used: usedCounts(bricks, lookup) };
}

/** Part ids that build with an owned part: what each number builds as, and its library twin. */
export function ownedPartIds(lists: readonly OwnedList[]): ReadonlySet<string> {
  return new Set(lists.flatMap((list) => list.lots.flatMap((lot) => [partIdFor(lot.part), `${LDRAW_PREFIX}${lot.part}`])));
}

/** Every owned part and colour BrickBench can build with, by name and then colour code. */
export function ownedLots({ owned, used }: Tally, lookup: PartLookup): OwnedLot[] {
  const lots: OwnedLot[] = [];
  for (const [key, have] of owned) {
    const bar = key.lastIndexOf('|');
    const part = lookup(partIdFor(key.slice(0, bar)));
    const color = Number(key.slice(bar + 1));
    if (!part || !getColor(color)) continue;
    const using = used.get(key) ?? 0;
    lots.push({ ...partInfo(part), color, color_name: colourName(color), owned: have, used: using, left: have - using });
  }
  return lots.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.color - b.color);
}

/** The colours of a part the user owns, with how many of each are left. */
export function ownedColours(partId: string, { owned, used }: Tally, lookup: PartLookup): { readonly color: number; readonly color_name: string; readonly left: number }[] {
  const number = partNumberOf(lookup(partId));
  if (!number) return [];
  const colours: { readonly color: number; readonly color_name: string; readonly left: number }[] = [];
  for (const [key, have] of owned) {
    const bar = key.lastIndexOf('|');
    if (key.slice(0, bar) !== number) continue;
    const color = Number(key.slice(bar + 1));
    colours.push({ color, color_name: colourName(color), left: have - (used.get(key) ?? 0) });
  }
  return colours.sort((a, b) => b.left - a.left || a.color - b.color);
}

/** Parts and colours among some bricks that the model now uses more of than the user owns. */
export function overOwned(bricks: readonly Brick[], { owned, used }: Tally, lookup: PartLookup): { readonly part: string; readonly color: number; readonly owned: number; readonly used: number }[] {
  const over = new Map<string, { readonly part: string; readonly color: number; readonly owned: number; readonly used: number }>();
  for (const brick of bricks) {
    const number = partNumberOf(lookup(brick.partId));
    if (!number) continue;
    const key = lotKey(number, brick.colorId);
    const using = used.get(key) ?? 0;
    const have = owned.get(key) ?? 0;
    if (using > have && !over.has(key)) over.set(key, { part: brick.partId, color: brick.colorId, owned: have, used: using });
  }
  return [...over.values()];
}
