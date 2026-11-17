/**
 * Matches a catalogue's parts list to what BrickBench can build: each part
 * number to an LDraw part the app has, each colour to a palette colour.
 * LDraw parts note the Rebrickable and BrickLink numbers that differ from
 * their own in their keywords ("BrickLink 4073"), and the library lists the
 * numbers LDraw moved or merged, so most lists match in full.
 */
import { getColor } from '../colors';
import type { LDrawIndexEntry } from '../ldraw/format';
import type { PartDef } from '../parts/types';
import { BRICKLINK_COLOURS, REBRICKABLE_COLOURS } from './colourNumbers';
import { MAX_QUANTITY, type Catalogue, type PartsListFile } from './read';

/** An LDraw part number, lower case, as the library names its parts: "3001", "3040b". */
export type PartNumber = string;

/** What BrickBench knows about part numbers. */
export interface PartNumbers {
  /** LDraw numbers of the parts it can build with. */
  readonly known: ReadonlySet<PartNumber>;
  /** Catalogue numbers LDraw parts note in their keywords, and which part each is. */
  readonly noted: { readonly [C in Catalogue]: ReadonlyMap<string, PartNumber> };
  /** Old LDraw numbers and the part each now is. */
  readonly aliases: ReadonlyMap<string, PartNumber>;
}

/** Parts of one kind and colour: LDraw numbers and codes. */
export interface Lot {
  readonly part: PartNumber;
  readonly colour: number;
  readonly quantity: number;
}

/** Parts of a list BrickBench cannot build with, in the list's own numbers, and why. */
export interface UnmatchedLot {
  readonly part: string;
  readonly colour: number;
  readonly quantity: number;
  /** "part": no such part in BrickBench; "colour": not a BrickBench colour. */
  readonly reason: 'part' | 'colour';
}

export interface MatchedList {
  readonly lots: readonly Lot[];
  readonly unmatched: readonly UnmatchedLot[];
}

const NOTE = /^(bricklink|rebrickable)\s+(\S+)$/i;

/** The LDraw number a part draws, lower case; null for parts without one. */
export function partNumberOf(part: Pick<PartDef, 'ldraw'> | undefined): PartNumber | null {
  return part?.ldraw ? part.ldraw.file.replace(/\.dat$/i, '').toLowerCase() : null;
}

/**
 * Collects the part numbers of the built-in parts and the library. When
 * several parts note the same catalogue number, the one with that very
 * number wins, then the first by number, so a list always matches the same way.
 */
export function partNumbersOf(builtIns: readonly PartDef[], entries: readonly LDrawIndexEntry[], aliases: ReadonlyMap<string, string>): PartNumbers {
  const known = new Set<PartNumber>(entries.map((e) => e.id));
  for (const part of builtIns) {
    const number = partNumberOf(part);
    if (number) known.add(number);
  }
  const noted = { rebrickable: new Map<string, PartNumber>(), bricklink: new Map<string, PartNumber>() };
  for (const entry of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const keyword of entry.keywords ?? []) {
      const match = NOTE.exec(keyword.trim());
      if (!match?.[1] || !match[2]) continue;
      const map = noted[match[1].toLowerCase() as Catalogue];
      const number = match[2].toLowerCase();
      if (!map.has(number) || number === entry.id) map.set(number, entry.id);
    }
  }
  return { known, noted, aliases };
}

/**
 * The part BrickBench has for a catalogue's number, or null. LDraw notes a
 * catalogue's number only where it differs from its own, so: the
 * catalogue's own note, then the same number, then the other catalogue's
 * note (Rebrickable mostly numbers parts as BrickLink does), then the part
 * LDraw renamed the number to.
 */
export function matchPart(number: string, catalogue: Catalogue, numbers: PartNumbers): PartNumber | null {
  const wanted = number.toLowerCase();
  const known = (candidate: string | undefined): PartNumber | null => (candidate !== undefined && numbers.known.has(candidate) ? candidate : null);
  const other: Catalogue = catalogue === 'rebrickable' ? 'bricklink' : 'rebrickable';
  return known(numbers.noted[catalogue].get(wanted)) ?? known(wanted) ?? known(numbers.noted[other].get(wanted)) ?? known(numbers.aliases.get(wanted));
}

/** The palette colour for a catalogue's colour number, or null. */
export function matchColour(colour: number, catalogue: Catalogue): number | null {
  const code = (catalogue === 'rebrickable' ? REBRICKABLE_COLOURS : BRICKLINK_COLOURS).get(colour);
  return code !== undefined && getColor(code) ? code : null;
}

/** Adds a line to a lot; a lot holds at most as many as one line may, as stored lists do. */
function addTo<T extends { readonly quantity: number }>(map: Map<string, T>, key: string, item: T): void {
  const held = map.get(key);
  map.set(key, held ? { ...held, quantity: Math.min(held.quantity + item.quantity, MAX_QUANTITY) } : item);
}

/** Splits a list into the lots BrickBench can build with and the rest, adding up repeated lines. */
export function matchList(list: PartsListFile, numbers: PartNumbers): MatchedList {
  const lots = new Map<string, Lot>();
  const unmatched = new Map<string, UnmatchedLot>();
  for (const line of list.parts) {
    const part = matchPart(line.part, list.catalogue, numbers);
    const colour = matchColour(line.colour, list.catalogue);
    if (part !== null && colour !== null) addTo(lots, `${part}|${colour}`, { part, colour, quantity: line.quantity });
    else {
      const reason = part === null ? 'part' : 'colour';
      addTo(unmatched, `${line.part}|${line.colour}|${reason}`, { part: line.part, colour: line.colour, quantity: line.quantity, reason });
    }
  }
  return { lots: [...lots.values()], unmatched: [...unmatched.values()] };
}
