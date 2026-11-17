import { COLORS, getColor, type BrickColor } from '../../colors';
import { LDRAW_COLOURS, type LDrawColourKind } from './colourTable';

/** A colour as an LDraw model gives it: a colour code, or a "direct" RGB colour. */
export type LDrawColour = { readonly code: number } | { readonly rgb: string; readonly transparent: boolean };

/** LDraw's "the colour of whatever holds me": submodels and parts take on their parent's colour. */
export const MAIN_COLOUR = 16;
/** LDraw's edge colour code, which means nothing for a placed part; treated like the main colour. */
export const EDGE_COLOUR = 24;
/** Parts a model leaves uncoloured come in light bluish grey. */
export const UNCOLOURED = 71;

/** Reads the colour of an LDraw type 1 line: a code ("4") or a direct colour ("0x2RRGGBB", "0x3RRGGBB" when transparent). */
export function readColour(token: string): LDrawColour | null {
  if (/^\d{1,9}$/.test(token)) return { code: Number(token) };
  const direct = /^(?:0x|#)([23])([0-9a-f]{6})$/i.exec(token);
  if (!direct?.[1] || !direct[2]) return null;
  return { rgb: `#${direct[2].toUpperCase()}`, transparent: direct[1] === '3' };
}

/** Whether the colour stands for the parent's: the main or edge colour code. */
export function inheritsColour(colour: LDrawColour): boolean {
  return 'code' in colour && (colour.code === MAIN_COLOUR || colour.code === EDGE_COLOUR);
}

export interface PaletteMatch {
  readonly colorId: number;
  /** False when the model's colour is not one of BrickBench's and the nearest stands in. */
  readonly exact: boolean;
  /** The model's colour as a person knows it: "Light Grey", "#336699". */
  readonly name: string;
}

const TABLE: ReadonlyMap<number, { readonly name: string; readonly hex: string; readonly kind: LDrawColourKind }> = new Map(
  LDRAW_COLOURS.map(([code, name, hex, kind]) => [code, { name, hex, kind }]),
);

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** CIE L*a*b* of an sRGB colour, where straight-line distance roughly follows what the eye sees. */
function toLab(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function kindOf(colour: BrickColor): LDrawColourKind {
  if (colour.finish === 'transparent') return 'transparent';
  return colour.finish === 'solid' ? 'solid' : 'metallic';
}

const CANDIDATES: ReadonlyMap<LDrawColourKind, readonly { readonly id: number; readonly lab: readonly [number, number, number] }[]> = new Map(
  (['solid', 'transparent', 'metallic'] as const).map((kind) => [
    kind,
    COLORS.filter((c) => kindOf(c) === kind).map((c) => ({ id: c.id, lab: toLab(c.hex) })),
  ]),
);

const nearestCache = new Map<string, number>();

/** The palette colour of the same finish that looks most like `hex`. */
export function nearestColour(hex: string, kind: LDrawColourKind): number {
  const key = `${kind}${hex}`;
  const cached = nearestCache.get(key);
  if (cached !== undefined) return cached;
  const [l, a, b] = toLab(hex);
  let best = UNCOLOURED;
  let bestDistance = Infinity;
  for (const candidate of CANDIDATES.get(kind) ?? []) {
    const distance = (candidate.lab[0] - l) ** 2 + (candidate.lab[1] - a) ** 2 + (candidate.lab[2] - b) ** 2;
    if (distance < bestDistance) {
      best = candidate.id;
      bestDistance = distance;
    }
  }
  nearestCache.set(key, best);
  return best;
}

/** The palette colour a model's colour comes in as, and whether that is the very colour. */
export function toPalette(colour: LDrawColour): PaletteMatch {
  if (!('code' in colour)) {
    return { colorId: nearestColour(colour.rgb, colour.transparent ? 'transparent' : 'solid'), exact: false, name: colour.rgb };
  }
  if (inheritsColour(colour)) return { colorId: UNCOLOURED, exact: false, name: 'No colour' };
  const own = getColor(colour.code);
  if (own) return { colorId: own.id, exact: true, name: own.name };
  const known = TABLE.get(colour.code);
  if (known) return { colorId: nearestColour(known.hex, known.kind), exact: false, name: known.name };
  return { colorId: UNCOLOURED, exact: false, name: `Colour ${colour.code}` };
}
