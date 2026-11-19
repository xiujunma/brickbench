import type { PartNumber, PartNumbers } from '../../inventory/match';
import { partIdFor } from '../../inventory/stock';
import { plainNumberOf } from '../../ldraw/prints';
import { fileKey } from './read';

/** The part BrickBench builds a model's part with. */
export interface ResolvedPart {
  readonly partId: string;
  /** The LDraw number BrickBench knows it by. */
  readonly number: PartNumber;
  /** A printed or stickered part that comes in plain. */
  readonly plain: boolean;
}

export interface PartResolver {
  /** The part a file names, under its own number or the one LDraw renamed it to; null otherwise. */
  exact(file: string): ResolvedPart | null;
  /** As `exact`, then by the catalogue numbers LDraw notes, then printed parts as their plain part. */
  resolve(file: string): ResolvedPart | null;
}

/** Model files a model may refer to: not parts, so missing ones are files left behind. */
const MODEL_FILE = /\.(?:ldr|mpd|l3b)$/i;
/**
 * LDraw's primitives, the shapes parts are drawn from, which some models
 * use to draw strings, wires and details: fractions of circles (4-4cyli),
 * boxes, rectangles and studs, and their 8 and 48 segment versions.
 */
const PRIMITIVE = /^(?:p\/)?(?:(?:8|48)\/)?(?:\d+-\d+[a-z]|box|rect|stud|tri|ring|disc|edge|ndis|chrd|cyl|con\d)[\w-]*$/;

export function isModelFile(file: string): boolean {
  return MODEL_FILE.test(file.trim());
}

/** Whether a file is one of LDraw's drawing primitives rather than a part. */
export function isPrimitive(file: string): boolean {
  return PRIMITIVE.test(numberOfFile(file));
}

/** "Parts\\3001.DAT" → "3001": the part number a file names, as the library writes it. */
export function numberOfFile(file: string): string {
  return fileKey(file).replace(/^parts\//, '').replace(/\.dat$/, '');
}

export function createPartResolver(numbers: PartNumbers): PartResolver {
  const known = (number: string | undefined): PartNumber | null => (number !== undefined && numbers.known.has(number) ? number : null);
  const direct = (number: string): PartNumber | null => known(number) ?? known(numbers.aliases.get(number));
  const resolved = (number: PartNumber | null, plain: boolean): ResolvedPart | null =>
    number === null ? null : { partId: partIdFor(number), number, plain };

  // a print the library lacks comes in as its plain part (3626bp01 as 3626b)
  const plainOf = (number: string): PartNumber | null => plainNumberOf(number, direct);

  const exact = (file: string): ResolvedPart | null => (isModelFile(file) ? null : resolved(direct(numberOfFile(file)), false));

  return {
    exact,
    resolve(file) {
      if (isModelFile(file)) return null;
      const number = numberOfFile(file);
      const noted = known(numbers.noted.bricklink.get(number)) ?? known(numbers.noted.rebrickable.get(number));
      return exact(file) ?? resolved(noted, false) ?? resolved(plainOf(number), true);
    },
  };
}
