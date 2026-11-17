/**
 * Reads parts lists exported from the two big part catalogues: Rebrickable
 * (CSV with Part, Color and Quantity columns) and BrickLink (XML inventories
 * and wanted lists, and BrickStore's files, which use BrickLink's numbers).
 * The files come from outside the app, so reading is bounded, takes one pass
 * and checks every line; nothing in them is ever run or shown as markup.
 */

export type Catalogue = 'rebrickable' | 'bricklink';

/** One line of a parts list, in its catalogue's numbers. */
export interface ListedPart {
  readonly part: string;
  readonly colour: number;
  readonly quantity: number;
}

export interface PartsListFile {
  readonly catalogue: Catalogue;
  readonly parts: readonly ListedPart[];
  /** Lines for things that are not single parts: minifigures, sets, alternates. */
  readonly notParts: number;
  /** Lines that could not be read, such as a missing part number or quantity. */
  readonly unreadable: number;
}

/** A file that is not a parts list this app can read; the message says why. */
export class PartsListError extends Error {
  override readonly name = 'PartsListError';
}

/** Far more than any set or collection export; it stops a wrong file from taking the tab down. */
export const MAX_LIST_BYTES = 8 * 1024 * 1024;
export const MAX_LIST_LINES = 100_000;
export const MAX_QUANTITY = 100_000;

const PART_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** Longest value a field of a list may hold; part numbers and counts are short. */
const MAX_FIELD = 200;

/** Reads a Rebrickable CSV or BrickLink XML parts list, telling them apart by their first character. */
export function readPartsList(text: string): PartsListFile {
  if (text.length > MAX_LIST_BYTES) throw new PartsListError('That file is too large to be a parts list.');
  const body = text.replace(/^﻿/, '').trimStart();
  if (body === '') throw new PartsListError('That file is empty.');
  return body.startsWith('<') ? readBrickLinkXml(body) : readRebrickableCsv(body);
}

/** A whole number in range, or null. */
function wholeNumber(text: string | undefined, min: number, max: number): number | null {
  const trimmed = (text ?? '').trim();
  if (!/^-?\d{1,9}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

function listedPart(part: string | undefined, colour: number | null, quantity: number | null): ListedPart | null {
  const number = (part ?? '').trim();
  if (!PART_NUMBER.test(number) || colour === null || quantity === null) return null;
  return { part: number, colour, quantity };
}

function checked(list: PartsListFile): PartsListFile {
  if (list.parts.length > 0) return list;
  throw new PartsListError(
    list.notParts > 0 ? 'That list has no single parts in it, only minifigures, sets or alternates.' : 'That list has no parts in it that could be read.',
  );
}

const tooLong = (): PartsListError => new PartsListError(`That list has more than ${MAX_LIST_LINES.toLocaleString('en')} lines.`);

// ---------- Rebrickable CSV ----------

/** Splits CSV text into rows of cells: quoted cells may hold commas, quotes ("") and line breaks. */
export function csvRows(text: string, maxRows: number = MAX_LIST_LINES + 1): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (rows.length > maxRows) throw tooLong();
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** Header names each column goes by, compared as letters only ("part_num" is "partnum"). */
const HEADERS = {
  part: ['part', 'partnum', 'partnumber', 'partno'],
  colour: ['color', 'colour', 'colorid', 'colourid'],
  quantity: ['quantity', 'qty', 'count'],
} as const;

const letters = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, '');

function columnOf(header: readonly string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(letters(cell)));
}

export function readRebrickableCsv(text: string): PartsListFile {
  const rows = csvRows(text);
  const header = rows[0] ?? [];
  const at = { part: columnOf(header, HEADERS.part), colour: columnOf(header, HEADERS.colour), quantity: columnOf(header, HEADERS.quantity) };
  if (at.part < 0 || at.colour < 0 || at.quantity < 0) {
    throw new PartsListError('That CSV has no Part, Color and Quantity columns. Export the parts from Rebrickable as “Rebrickable CSV”.');
  }
  const parts: ListedPart[] = [];
  let unreadable = 0;
  for (const row of rows.slice(1)) {
    const part = listedPart(row[at.part], wholeNumber(row[at.colour], -1, 99_999_999), wholeNumber(row[at.quantity], 1, MAX_QUANTITY));
    if (part) parts.push(part);
    else unreadable += 1;
  }
  return checked({ catalogue: 'rebrickable', parts, notParts: 0, unreadable });
}

// ---------- BrickLink XML ----------

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '');
}

/**
 * The fields of each <ITEM> in a BrickLink or BrickStore file, with tag names
 * upper-cased (BrickLink writes ITEMID, BrickStore ItemID). One pass from tag
 * to tag: each character is looked at a fixed number of times.
 */
export function xmlItems(text: string, maxItems: number = MAX_LIST_LINES): Map<string, string>[] {
  const items: Map<string, string>[] = [];
  let item: Map<string, string> | null = null;
  let at = text.indexOf('<');
  while (at !== -1) {
    const end = text.indexOf('>', at + 1);
    if (end === -1) break;
    const next = text.indexOf('<', end + 1);
    const tag = text.slice(at + 1, Math.min(end, at + 1 + MAX_FIELD));
    const name = (/^\/?([A-Za-z][\w.-]*)/.exec(tag)?.[1] ?? '').toUpperCase();
    const closing = tag.startsWith('/');
    if (name === 'ITEM') {
      if (closing && item) items.push(item);
      if (items.length > maxItems) throw tooLong();
      item = closing ? null : new Map();
    } else if (item && !closing && name !== '' && !item.has(name)) {
      const value = text.slice(end + 1, next === -1 ? text.length : next);
      if (value.length <= MAX_FIELD) item.set(name, decode(value).trim());
    }
    at = next;
  }
  return items;
}

const field = (item: ReadonlyMap<string, string>, ...names: string[]): string | undefined =>
  names.map((name) => item.get(name)).find((value) => value !== undefined);

export function readBrickLinkXml(text: string): PartsListFile {
  if (!/<(inventory|brickstorexml|wantedlist)\b/i.test(text.slice(0, 4096))) {
    throw new PartsListError('That XML file is not a BrickLink inventory or wanted list.');
  }
  const parts: ListedPart[] = [];
  let notParts = 0;
  let unreadable = 0;
  for (const item of xmlItems(text)) {
    const type = (field(item, 'ITEMTYPE', 'ITEMTYPEID') ?? 'P').toUpperCase();
    // alternates stand in for other items; counterparts come with another set
    const flagged = (name: string): boolean => (item.get(name) ?? '').toUpperCase() === 'Y';
    if (type !== 'P' || flagged('ALTERNATE') || flagged('COUNTERPART')) {
      notParts += 1;
      continue;
    }
    const quantity = field(item, 'QTY', 'MINQTY');
    const part = listedPart(
      field(item, 'ITEMID'),
      wholeNumber(field(item, 'COLOR', 'COLORID') ?? '0', 0, 99_999),
      quantity === undefined ? 1 : wholeNumber(quantity, 1, MAX_QUANTITY),
    );
    if (part) parts.push(part);
    else unreadable += 1;
  }
  return checked({ catalogue: 'bricklink', parts, notParts, unreadable });
}
