/**
 * The parts the user owns, set against the parts a model uses: per LDraw
 * part number and colour, so a basic 2 × 4 brick and the library's 3001
 * draw on the same bricks in the box.
 */
import type { Brick } from '../model/types';
import { PARTS } from '../parts/catalog';
import { LDRAW_PREFIX } from '../ldraw/catalogIndex';
import type { PartLookup } from '../parts/types';
import { matchList, partNumberOf, type Lot, type PartNumber, type PartNumbers, type UnmatchedLot } from './match';
import { MAX_QUANTITY, type Catalogue } from './read';

/** A parts list the user owns, such as one set's, matched to BrickBench's parts and colours. */
export interface OwnedList {
  readonly id: string;
  readonly name: string;
  readonly catalogue: Catalogue;
  /** How many of the set the user has: every lot counts this many times. */
  readonly copies: number;
  readonly lots: readonly Lot[];
  readonly unmatched: readonly UnmatchedLot[];
}

/** Counts per lot, keyed by lotKey. */
export type Counts = ReadonlyMap<string, number>;

export interface Stock {
  readonly owned: number;
  readonly used: number;
  /** Owned less used: below zero when the model uses more than the user has. */
  readonly left: number;
}

export const lotKey = (part: PartNumber, colour: number): string => `${part}|${colour}`;

function add(counts: Map<string, number>, key: string, n: number): void {
  counts.set(key, (counts.get(key) ?? 0) + n);
}

/** How many of each part and colour the lists add up to, copies counted. */
export function ownedCounts(lists: readonly OwnedList[]): Counts {
  const counts = new Map<string, number>();
  for (const list of lists) for (const lot of list.lots) add(counts, lotKey(lot.part, lot.colour), lot.quantity * list.copies);
  return counts;
}

/** How many of each part and colour bricks use; parts without an LDraw number count for nothing. */
export function usedCounts(bricks: Iterable<Brick>, lookup: PartLookup): Counts {
  const counts = new Map<string, number>();
  for (const brick of bricks) {
    const number = partNumberOf(lookup(brick.partId));
    if (number) add(counts, lotKey(number, brick.colorId), 1);
  }
  return counts;
}

export function stockOf(owned: Counts, used: Counts, part: PartNumber, colour: number): Stock {
  const key = lotKey(part, colour);
  const have = owned.get(key) ?? 0;
  const using = used.get(key) ?? 0;
  return { owned: have, used: using, left: have - using };
}

/**
 * Matches a list's left-out parts again, as when the library has loaded
 * after the list was added, or has grown since: those BrickBench can now
 * build with join the list's lots. The same list when nothing new matches.
 */
export function rematchList(list: OwnedList, numbers: PartNumbers): OwnedList {
  if (list.unmatched.length === 0) return list;
  const again = matchList({ catalogue: list.catalogue, parts: list.unmatched, notParts: 0, unreadable: 0 }, numbers);
  if (again.lots.length === 0) return list;
  const lots = new Map(list.lots.map((lot) => [lotKey(lot.part, lot.colour), lot]));
  for (const lot of again.lots) {
    const key = lotKey(lot.part, lot.colour);
    const held = lots.get(key);
    lots.set(key, held ? { ...held, quantity: Math.min(held.quantity + lot.quantity, MAX_QUANTITY) } : lot);
  }
  return { ...list, lots: [...lots.values()], unmatched: again.unmatched };
}

/** A parts list row with how many of it the user has and how many they still need. */
export type StockedRow<T> = T & { readonly have: number; readonly missing: number };

/**
 * Shares what the user owns out over a model's parts list, row by row: a
 * basic part and its library twin draw on the same bricks, so they share.
 */
export function allotStock<T extends { readonly partId: string; readonly colorId: number; readonly quantity: number }>(
  rows: readonly T[],
  owned: Counts,
  lookup: PartLookup,
): StockedRow<T>[] {
  const left = new Map<string, number>();
  return rows.map((row) => {
    const number = partNumberOf(lookup(row.partId));
    const key = number === null ? null : lotKey(number, row.colorId);
    const available = key === null ? 0 : (left.get(key) ?? owned.get(key) ?? 0);
    const have = Math.min(row.quantity, available);
    if (key !== null) left.set(key, available - have);
    return { ...row, have, missing: row.quantity - have };
  });
}

let builtInIds: ReadonlyMap<PartNumber, string> | null = null;

/** The part to build with for an LDraw number: the basic part that draws it, else the library's. */
export function partIdFor(number: PartNumber): string {
  if (!builtInIds) {
    const ids = new Map<PartNumber, string>();
    for (const part of PARTS) {
      const own = partNumberOf(part);
      if (own && !ids.has(own)) ids.set(own, part.id);
    }
    builtInIds = ids;
  }
  return builtInIds.get(number) ?? `${LDRAW_PREFIX}${number}`;
}
