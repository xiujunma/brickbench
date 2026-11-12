/** Built-in categories, plus 'library' for parts from the shipped LDraw library. */
export type PartCategory = 'bricks' | 'plates' | 'tiles' | 'slopes' | 'round' | 'arches' | 'library';

/** Half-open box of grid cells in a part's local frame (x/z in studs, y in plates). */
export interface CellBox {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

/**
 * Geometry recipe for a part body. Slopes keep their stud rows at -Z and fall
 * towards +Z; `run` is how many studs the sloped section spans. 'mesh' parts
 * come from the LDraw library: their mesh, studs included, loads on demand.
 */
export type PartShape =
  | { readonly kind: 'box' }
  | { readonly kind: 'slope'; readonly run: number; readonly inverted: boolean }
  | { readonly kind: 'round'; readonly profile: 'cylinder' | 'cone' }
  | { readonly kind: 'arch'; readonly span: number; readonly rise: number }
  | { readonly kind: 'mesh' };

export interface LDrawRef {
  /** Part file in the LDraw library, e.g. `3001.dat`. */
  readonly file: string;
  /** Where the LDraw part origin sits in the local frame, in world units. */
  readonly origin: readonly [number, number, number];
}

/**
 * A part in the catalogue. The local frame is centred on the footprint with
 * y = 0 at the bottom: x ∈ [-w/2, w/2], z ∈ [-d/2, d/2], y ∈ [0, h·PLATE_HEIGHT].
 */
export interface PartDef {
  readonly id: string;
  readonly name: string;
  readonly category: PartCategory;
  /** Width along X in studs. */
  readonly w: number;
  /** Depth along Z in studs. */
  readonly d: number;
  /** Height in plates. */
  readonly h: number;
  /** Footprint cells (x, z) carrying a stud on the top face. */
  readonly studs: readonly (readonly [number, number])[];
  /** Cells the part occupies, used for collisions and picking. */
  readonly solids: readonly CellBox[];
  readonly shape: PartShape;
  readonly ldraw?: LDrawRef | undefined;
  readonly keywords: readonly string[];
}

export type PartLookup = (id: string) => PartDef | undefined;
