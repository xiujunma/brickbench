/**
 * Parts to buy, written for the two big catalogues: a BrickLink wanted list
 * (XML, for Wanted › Upload) and a Rebrickable parts list (CSV). The inverse
 * of match.ts: a catalogue's number for a part is the one LDraw notes in its
 * keywords ("BrickLink 3040" on 3040b) or, where it notes none, LDraw's own;
 * colours go back through the tables in colourNumbers.ts.
 */
import { BRICKLINK_COLOURS, REBRICKABLE_COLOURS } from './colourNumbers';
import { MAX_QUANTITY, type Catalogue } from './read';
import type { PartNumber } from './match';

/** Parts of one kind and colour to buy, in LDraw's numbers. */
export interface WantedLot {
  readonly part: PartNumber;
  readonly colour: number;
  readonly quantity: number;
  /** What the lot is, for saying what was left out: "Brick 2 × 4 in Red". */
  readonly label: string;
}

/** One line of a catalogue's list, in its numbers. */
export interface CatalogueLine {
  readonly part: string;
  readonly colour: number;
  readonly quantity: number;
}

export interface CatalogueList {
  readonly catalogue: Catalogue;
  readonly lines: readonly CatalogueLine[];
  /** Lots the catalogue has no colour for, so the list leaves them out. */
  readonly leftOut: readonly WantedLot[];
}

const NAMES: Readonly<Record<Catalogue, string>> = { bricklink: 'bricklink', rebrickable: 'rebrickable' };

/** The catalogue's colour for each LDraw code: the id equal to the code where there is one, else the lowest. */
function invert(colours: ReadonlyMap<number, number>): ReadonlyMap<number, number> {
  const inverse = new Map<number, number>();
  for (const [id, code] of [...colours].sort(([a], [b]) => a - b)) {
    if (!inverse.has(code) || id === code) inverse.set(code, id);
  }
  return inverse;
}

const CATALOGUE_COLOURS: Readonly<Record<Catalogue, ReadonlyMap<number, number>>> = {
  bricklink: invert(BRICKLINK_COLOURS),
  rebrickable: invert(REBRICKABLE_COLOURS),
};

/** A catalogue's colour id for an LDraw colour code, or null when it has none. */
export function catalogueColour(code: number, catalogue: Catalogue): number | null {
  return CATALOGUE_COLOURS[catalogue].get(code) ?? null;
}

/** A catalogue's number for an LDraw part: the first one LDraw notes for it in `keywords`, or its own. */
export function catalogueNumber(part: PartNumber, keywords: readonly string[], catalogue: Catalogue): string {
  for (const keyword of keywords) {
    const [name, number, ...rest] = keyword.trim().split(/\s+/);
    if (rest.length === 0 && number !== undefined && name?.toLowerCase() === NAMES[catalogue]) return number;
  }
  return part;
}

/**
 * The lots in a catalogue's numbers, with lots that come out the same (two
 * parts the catalogue numbers alike) added together, in the order given.
 */
export function toCatalogue(lots: readonly WantedLot[], catalogue: Catalogue, keywordsOf: (part: PartNumber) => readonly string[]): CatalogueList {
  const lines = new Map<string, CatalogueLine>();
  const leftOut: WantedLot[] = [];
  for (const lot of lots) {
    const colour = catalogueColour(lot.colour, catalogue);
    if (colour === null) {
      leftOut.push(lot);
      continue;
    }
    const part = catalogueNumber(lot.part, keywordsOf(lot.part), catalogue);
    const key = `${part}|${colour}`;
    const held = lines.get(key);
    lines.set(key, { part, colour, quantity: Math.min((held?.quantity ?? 0) + lot.quantity, MAX_QUANTITY) });
  }
  return { catalogue, lines: [...lines.values()], leftOut };
}

const XML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (text: string): string => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);

/** A BrickLink wanted list: each line an item of type P (part) with the minimum quantity wanted. */
export function brickLinkWantedList(lines: readonly CatalogueLine[]): string {
  const items = lines.map(
    (line) =>
      `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${xml(line.part)}</ITEMID>\n    <COLOR>${line.colour}</COLOR>\n    <MINQTY>${line.quantity}</MINQTY>\n  </ITEM>`,
  );
  return ['<INVENTORY>', ...items, '</INVENTORY>', ''].join('\n');
}

/** A Rebrickable parts list, in the columns Rebrickable's own CSV export has. */
export function rebrickableCsv(lines: readonly CatalogueLine[]): string {
  // part numbers are letters, digits, dashes and underscores, so none needs quoting
  const rows = lines.map((line) => `${line.part.replace(/[^\w.-]/g, '')},${line.colour},${line.quantity}`);
  return ['Part,Color,Quantity', ...rows, ''].join('\r\n');
}
