/**
 * Reads LDraw model text: single .ldr files and multi-part .mpd files, as
 * LDraw editors, LeoCAD and BrickLink Studio write them. What matters here
 * are the lines that place parts and submodels (type 1); shapes drawn
 * inline (types 2 to 5) only mark a file as a part of its own.
 */
import { readColour, type LDrawColour } from './colours';

export type V3 = readonly [number, number, number];
/** A 3 × 3 matrix, row by row, as an LDraw type 1 line gives it. */
export type M3 = readonly [number, number, number, number, number, number, number, number, number];

/** One type 1 line: a part or submodel, its colour, where it goes and how it is turned. */
export interface PartLine {
  readonly colour: LDrawColour;
  /** In LDraw units (LDU): 20 to a stud, 8 to a plate, -Y up. */
  readonly position: V3;
  readonly matrix: M3;
  /** The part or submodel file, as the line names it ("3001.dat", "motor bogie"). */
  readonly file: string;
}

/** What a file says it is in its `0 !LDRAW_ORG` line: a part (or a piece of one), a model, or nothing. */
export type DeclaredKind = 'part' | 'model' | null;

export interface LDrawFile {
  readonly name: string;
  /** The file's first comment line, LDraw's title for it ("" if none). */
  readonly title: string;
  readonly lines: readonly PartLine[];
  /** It draws shapes of its own (lines, triangles, quads), as parts do. */
  readonly drawsShapes: boolean;
  readonly declared: DeclaredKind;
}

export interface LDrawDocument {
  /** The first file: the model itself. */
  readonly main: LDrawFile;
  /** Every file by its key (see fileKey), the main one included. */
  readonly files: ReadonlyMap<string, LDrawFile>;
  /** Type 1 lines that could not be read. */
  readonly badLines: number;
}

/** LDraw file names ignore case and may use either slash: "Parts\\3001.DAT" and "parts/3001.dat" are one file. */
export function fileKey(name: string): string {
  return name.trim().replace(/\\/g, '/').toLowerCase();
}

/** Meta commands and remarks that are not a file's title when they come first. */
const NOT_A_TITLE = /^(?:!|\/\/|name:|author:|step\b|bfc\b|nofile\b|file\b|clear\b|pause\b|save\b|write\b|print\b)/i;
const PART_LINE = /^1\s+(\S+)((?:\s+\S+){12})\s+(.+)$/;
const SHAPE_LINE = /^[2-5]\s/;
const FILE_LINE = /^0\s+FILE\s+(.+)$/;
/** NOFILE ends a file; !DATA starts embedded data (a texture), part of no model. */
const END_OF_FILE = /^0\s+(?:NOFILE|!DATA)\b/;
const LDRAW_ORG = /^0\s+!LDRAW_ORG\s+(\S+)/i;

interface Builder {
  readonly name: string;
  /** Opened by the text itself rather than by a `0 FILE` line. */
  readonly implicit: boolean;
  title: string | null;
  readonly lines: PartLine[];
  drawsShapes: boolean;
  declared: DeclaredKind;
}

interface Reading {
  readonly files: Map<string, LDrawFile>;
  first: Builder | null;
  current: Builder | null;
  multipart: boolean;
  badLines: number;
}

function readPartLine(line: string): PartLine | null {
  const match = PART_LINE.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const colour = readColour(match[1]);
  const numbers = match[2].trim().split(/\s+/).map(Number);
  if (!colour || numbers.length !== 12 || !numbers.every(Number.isFinite)) return null;
  const [x = 0, y = 0, z = 0, ...m] = numbers;
  return { colour, position: [x, y, z], matrix: m as unknown as M3, file: match[3].trim() };
}

/** "Unofficial_Part", "Subpart", "48_Primitive", "Shortcut" → part; "Model", "Unofficial_Model" → model. */
function declaredKind(kind: string): DeclaredKind {
  if (/model/i.test(kind)) return 'model';
  return /part|primitive|shortcut/i.test(kind) ? 'part' : null;
}

function built(builder: Builder): LDrawFile {
  return { name: builder.name, title: builder.title ?? '', lines: builder.lines, drawsShapes: builder.drawsShapes, declared: builder.declared };
}

function open(reading: Reading, name: string, implicit: boolean): Builder {
  const builder: Builder = { name, implicit, title: null, lines: [], drawsShapes: false, declared: null };
  reading.first ??= builder;
  reading.current = builder;
  return builder;
}

/** Comments before a multi-part file's first `0 FILE` are no file of their own, let alone its model. */
function dropPreamble(reading: Reading): void {
  const { current } = reading;
  if (!current?.implicit || current.lines.length > 0) return;
  if (reading.first === current) reading.first = null;
  reading.current = null;
}

function close(reading: Reading): void {
  const { current } = reading;
  // the first of two files with one name wins, as in LDraw viewers
  if (current && !reading.files.has(fileKey(current.name))) reading.files.set(fileKey(current.name), built(current));
  reading.current = null;
}

function addLine(builder: Builder, line: string, reading: Reading): void {
  if (line.startsWith('0')) {
    const comment = line.slice(1).trim();
    if (builder.title === null) builder.title = NOT_A_TITLE.test(comment) ? '' : comment;
    const org = LDRAW_ORG.exec(line);
    if (org?.[1]) builder.declared = declaredKind(org[1]);
  } else if (line.startsWith('1')) {
    const part = readPartLine(line);
    if (part) builder.lines.push(part);
    else reading.badLines += 1;
  } else if (SHAPE_LINE.test(line)) {
    builder.drawsShapes = true;
  }
}

/**
 * Splits LDraw text into its files. A text without `0 FILE` lines is one
 * file named `fileName`; in a multi-part file the first part is the model.
 */
export function readLDraw(text: string, fileName: string): LDrawDocument {
  const reading: Reading = { files: new Map(), first: null, current: null, multipart: false, badLines: 0 };

  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const declared = FILE_LINE.exec(line);
    if (declared?.[1]) {
      dropPreamble(reading);
      close(reading);
      open(reading, declared[1].trim(), false);
      reading.multipart = true;
      continue;
    }
    if (END_OF_FILE.test(line)) {
      close(reading);
      continue;
    }
    // lines between a NOFILE and the next FILE belong to no file
    const builder = reading.current ?? (reading.multipart ? null : open(reading, fileName, true));
    if (builder) addLine(builder, line, reading);
  }
  close(reading);

  const first = reading.first ? built(reading.first) : { name: fileName, title: '', lines: [], drawsShapes: false, declared: null };
  const key = fileKey(first.name);
  if (!reading.files.has(key)) reading.files.set(key, first);
  return { main: reading.files.get(key) ?? first, files: reading.files, badLines: reading.badLines };
}
