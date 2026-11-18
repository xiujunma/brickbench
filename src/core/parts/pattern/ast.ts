/**
 * What a part pattern reads as. docs/part-patterns.md defines the language;
 * parse.ts reads it into these, match.ts tests parts against them.
 */
import type { TopFace } from './topFace';

/** Kinds of part, each written as a capital letter. */
export type Kind = 'B' | 'P' | 'T' | 'S' | 'R' | 'C' | 'A';

export const KIND_NAMES: Readonly<Record<Kind, string>> = {
  B: 'brick',
  P: 'plate',
  T: 'tile',
  S: 'slope',
  R: 'round',
  C: 'cone',
  A: 'arch',
};

/** The height, in plates, a kind means when a pattern gives none: a brick is one brick tall, plates and tiles one plate. */
export const DEFAULT_PLATES: Readonly<Partial<Record<Kind, number>>> = { B: 3, P: 1, T: 1 };

export function isKind(text: string): text is Kind {
  return Object.hasOwn(KIND_NAMES, text);
}

/** One measure a part term allows: any, a range, or a choice of values. */
export type Dim =
  | { readonly type: 'any' }
  | { readonly type: 'range'; readonly min: number; readonly max: number }
  | { readonly type: 'set'; readonly values: readonly number[] };

/** A footprint's two sides, matched either way round. */
export interface Footprint {
  readonly a: Dim;
  readonly b: Dim;
}

export interface Height {
  readonly dim: Dim;
  /** Plates per step: 1 for ^, 3 for a third size, which counts bricks. */
  readonly unit: 1 | 3;
}

/** A part term, such as P2x4 or S45[oo/..]^3: each part it gives must hold. */
export interface PartTerm {
  /** null for any kind. */
  readonly kind: Kind | null;
  /** A slope's angle in degrees; null for any. */
  readonly angle: number | null;
  /** Only inverted slopes. */
  readonly inverted: boolean;
  readonly footprint: Footprint | null;
  readonly face: TopFace | null;
  /** null for any height. */
  readonly height: Height | null;
}

export type Source = 'basic' | 'library' | 'owned';

export type PatternNode =
  | { readonly type: 'part'; readonly term: PartTerm }
  /** A feature or nickname (+clip, -clip, +cheese). */
  | { readonly type: 'feature'; readonly name: string; readonly wanted: boolean }
  /** A palette colour, by LDraw code. */
  | { readonly type: 'colour'; readonly colour: number }
  /** A part number glob, lower case: * any run, ? any one character. */
  | { readonly type: 'number'; readonly glob: string }
  | { readonly type: 'source'; readonly source: Source }
  /** Words the part's name has, normalised for search. */
  | { readonly type: 'name'; readonly words: readonly string[] }
  | { readonly type: 'not'; readonly node: PatternNode }
  | { readonly type: 'and'; readonly nodes: readonly PatternNode[] }
  | { readonly type: 'or'; readonly nodes: readonly PatternNode[] };

export interface PartPattern {
  /** The pattern as written. */
  readonly text: string;
  readonly root: PatternNode;
}
