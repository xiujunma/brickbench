import { normalizeRotation } from '../../grid';
import type { Result } from '../modelFile';
import { MAIN_COLOUR, inheritsColour, type LDrawColour } from './colours';
import { isModelFile } from './match';
import { fileKey, type LDrawDocument, type LDrawFile, type M3, type V3 } from './read';
import { turnMatrix } from './toGrid';

/** A part placed in the model, wherever in its submodels it came from. */
export interface Placement {
  /** The part file as the model names it. */
  readonly file: string;
  /**
   * The use of a submodel the part came in with: the line numbers leading
   * to it ("3/12"), "" for parts the model places itself. Each use is
   * built as one piece, so its parts keep their places among themselves.
   */
  readonly group: string;
  /** That submodel's name as the model writes it; the model's own name for "". */
  readonly groupName: string;
  /** The outermost submodel around it that was turned square to come in (see squareUp), if any. */
  readonly squared: string | null;
  /** The submodels on the way to it, outermost first, as the model names them: one for each level of `group`. */
  readonly submodels: readonly string[];
  /** The building step of its line, and of each submodel's line on the way to it: the model's first, its own last. */
  readonly steps: readonly number[];
  /** Its colour, "the parent's colour" resolved; the main colour code when nothing above gave one. */
  readonly colour: LDrawColour;
  /** Where it sits in the model, in LDU. */
  readonly position: V3;
  readonly matrix: M3;
}

export interface Flattened {
  /** Parts in the order the model adds them, so in building order. */
  readonly placements: readonly Placement[];
  /** Submodel references skipped because they lead back into themselves or nest too deep. */
  readonly skipped: number;
}

export interface FlattenLimits {
  /** Most parts a model may place. */
  readonly maxParts: number;
  /** Most lines to follow in all, which stops models nesting empty submodels into an endless walk. */
  readonly maxReferences: number;
}

/** Deeper than any real model nests its submodels. */
export const MAX_NESTING = 64;
const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ORIGIN: V3 = [0, 0, 0];
const QUARTER_TURN = Math.PI / 2;
/** How far from 0 or 1 an entry may stray for a matrix to count as upright: editors round. */
const UPRIGHT_TOLERANCE = 1e-3;
/** Turns closer than this to a quarter turn (radians, about 0.06°) already are one. */
const SQUARE_TOLERANCE = 1e-3;

/**
 * Model files often stand a vehicle or a figure at an angle for show: a
 * submodel turned about the vertical by 30°, say. BrickBench turns parts
 * in quarter turns only, so such a submodel comes in turned to the nearest
 * quarter turn, about its own origin, its parts together as built. Returns
 * that quarter turn, or null for a matrix already square or not upright.
 */
export function squareUp(m: M3): M3 | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= UPRIGHT_TOLERANCE;
  const upright =
    near(m[1], 0) && near(m[3], 0) && near(m[5], 0) && near(m[7], 0) && near(m[4], 1) && near(m[0], m[8]) && near(m[2], -m[6]) && near(m[0] ** 2 + m[6] ** 2, 1);
  if (!upright) return null;
  const angle = Math.atan2(m[6], m[0]);
  const quarters = Math.round(angle / QUARTER_TURN);
  if (Math.abs(angle - quarters * QUARTER_TURN) <= SQUARE_TOLERANCE) return null;
  return turnMatrix(normalizeRotation(quarters));
}

/** m · v + t */
export function transformPoint(m: M3, v: V3, t: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + t[0],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + t[1],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + t[2],
  ];
}

/** a · b */
export function multiply(a: M3, b: M3): M3 {
  const cell = (row: number, col: number): number => a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
  return [cell(0, 0), cell(0, 1), cell(0, 2), cell(1, 0), cell(1, 1), cell(1, 2), cell(2, 0), cell(2, 1), cell(2, 2)];
}

/** Where the parts of a file go: its place and turn in the model, and what they inherit (see Placement). */
interface Frame {
  readonly position: V3;
  readonly matrix: M3;
  readonly colour: LDrawColour;
  readonly group: string;
  readonly groupName: string;
  readonly squared: string | null;
  readonly submodels: readonly string[];
  /** The steps of the submodels' lines on the way here. */
  readonly steps: readonly number[];
}

/**
 * Whether a file the model holds is a submodel to build part by part, or a
 * part of its own the model brings along (LDraw draws parts from shapes and
 * from pieces of other parts). Its `0 !LDRAW_ORG` line says, if it has one;
 * then a model file's name, or the absence of shapes. A file that draws
 * shapes and also places others is a submodel when most of what it places
 * are parts or submodels: a stray line drawn into a model does not make it
 * a part.
 */
export function isSubmodel(file: LDrawFile, name: string, isKnown: (file: string) => boolean): boolean {
  if (file.lines.length === 0 || file.declared === 'part') return false;
  if (file.declared === 'model' || isModelFile(name) || !file.drawsShapes) return true;
  const known = file.lines.filter((line) => isKnown(line.file)).length;
  return known * 2 > file.lines.length;
}

class TooBig extends Error {
  constructor(readonly limit: keyof FlattenLimits) {
    super(limit);
  }
}

/**
 * Walks the model and its submodels into one list of placed parts, each
 * with its place, turn and colour in the model as a whole. A file the model
 * itself holds is a submodel (see isSubmodel), unless `isPart` knows a part
 * by its name. Submodels stood at an angle are turned square (see squareUp).
 */
export function flatten(doc: LDrawDocument, isPart: (file: string) => boolean, limits: FlattenLimits): Result<Flattened> {
  const placements: Placement[] = [];
  const active = new Set<string>([fileKey(doc.main.name)]);
  const isKnown = (file: string): boolean => isPart(file) || doc.files.has(fileKey(file));
  let skipped = 0;
  let references = 0;

  const visit = (file: LDrawFile, frame: Frame, depth: number): void => {
    for (const [index, line] of file.lines.entries()) {
      references += 1;
      if (references > limits.maxReferences) throw new TooBig('maxReferences');
      const at = transformPoint(frame.matrix, line.position, frame.position);
      const colour = inheritsColour(line.colour) ? frame.colour : line.colour;
      const key = fileKey(line.file);
      const sub = isPart(line.file) ? undefined : doc.files.get(key);
      if (sub && isSubmodel(sub, line.file, isKnown)) {
        if (active.has(key) || depth >= MAX_NESTING) {
          skipped += 1;
          continue;
        }
        const square = squareUp(line.matrix);
        active.add(key);
        visit(
          sub,
          {
            position: at,
            matrix: multiply(frame.matrix, square ?? line.matrix),
            colour,
            group: frame.group === '' ? String(index) : `${frame.group}/${index}`,
            groupName: line.file,
            squared: frame.squared ?? (square ? line.file : null),
            submodels: [...frame.submodels, line.file],
            steps: [...frame.steps, line.step],
          },
          depth + 1,
        );
        active.delete(key);
      } else if (!sub || sub.drawsShapes || sub.lines.length > 0) {
        // a part, a part the model brings along, or a file it does not hold (an empty submodel places nothing)
        const { group, groupName, squared, submodels } = frame;
        const steps = [...frame.steps, line.step];
        placements.push({ file: line.file, group, groupName, squared, submodels, steps, colour, position: at, matrix: multiply(frame.matrix, line.matrix) });
        if (placements.length > limits.maxParts) throw new TooBig('maxParts');
      }
    }
  };

  try {
    visit(doc.main, { position: ORIGIN, matrix: IDENTITY, colour: { code: MAIN_COLOUR }, group: '', groupName: doc.main.name, squared: null, submodels: [], steps: [] }, 0);
  } catch (error: unknown) {
    if (!(error instanceof TooBig)) throw error;
    return {
      ok: false,
      error:
        error.limit === 'maxParts'
          ? `This model is too big to open: it has more than ${limits.maxParts.toLocaleString('en')} parts.`
          : 'This model nests its submodels too many times over to open.',
    };
  }
  return { ok: true, value: { placements, skipped } };
}
