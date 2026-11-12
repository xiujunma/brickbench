import { PLATE_HEIGHT } from '../grid';
import { archCurve, archHeightAt } from './arch';
import type { CellBox, PartCategory, PartDef } from './types';

const BRICK = 3;
const PLATE = 1;
/** How far an arch curve may dip into a cell before the cell counts as blocked. */
const ARCH_TOLERANCE = 0.05;

export interface CategoryInfo {
  readonly id: PartCategory;
  readonly label: string;
}

export const PART_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'bricks', label: 'Bricks' },
  { id: 'plates', label: 'Plates' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'slopes', label: 'Slopes' },
  { id: 'round', label: 'Round' },
  { id: 'arches', label: 'Arches' },
];

type Triple = readonly [number, number, number];

function studGrid(
  w: number,
  d: number,
  keep: (x: number, z: number) => boolean = () => true,
): (readonly [number, number])[] {
  const studs: (readonly [number, number])[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) if (keep(x, z)) studs.push([x, z]);
  }
  return studs;
}

function fullBox(w: number, d: number, h: number): CellBox {
  return { x0: 0, y0: 0, z0: 0, x1: w, y1: h, z1: d };
}

function topCentre(h: number): Triple {
  return [0, h * PLATE_HEIGHT, 0];
}

function ldraw(file: string, origin: Triple): PartDef['ldraw'] {
  return { file: `${file}.dat`, origin };
}

function heightLabel(plates: number): string {
  return plates % BRICK === 0 ? `${plates / BRICK}` : `${plates}/${BRICK}`;
}

function rectangular(
  kind: 'Brick' | 'Plate' | 'Tile',
  short: number,
  long: number,
  file: string,
  bricksTall = 1,
): PartDef {
  const h = kind === 'Brick' ? BRICK * bricksTall : PLATE;
  const tall = bricksTall > 1;
  const category: PartCategory = kind === 'Brick' ? 'bricks' : kind === 'Plate' ? 'plates' : 'tiles';
  return {
    id: `${kind.toLowerCase()}-${short}x${long}${tall ? `x${bricksTall}` : ''}`,
    name: `${kind} ${short} × ${long}${tall ? ` × ${bricksTall}` : ''}`,
    category,
    w: long,
    d: short,
    h,
    studs: kind === 'Tile' ? [] : studGrid(long, short),
    solids: [fullBox(long, short, h)],
    shape: { kind: 'box' },
    ldraw: ldraw(file, topCentre(h)),
    keywords: kind === 'Tile' ? ['tile', 'flat', 'smooth'] : [kind.toLowerCase()],
  };
}

interface SlopeSpec {
  readonly angle: number;
  /** Studs along the fall line (Z). */
  readonly depth: number;
  /** Studs across the slope (X). */
  readonly width: number;
  readonly h: number;
  readonly run: number;
  readonly inverted?: boolean;
  readonly file: string;
  readonly id?: string;
  readonly origin?: Triple;
  readonly keywords?: readonly string[];
}

function slope(spec: SlopeSpec): PartDef {
  const { angle, depth, width, h, run, inverted = false } = spec;
  const studRows = depth - run;
  const tall = h === BRICK ? '' : `x${heightLabel(h).replace('/', '-')}`;
  const tallName = h === BRICK ? '' : ` × ${heightLabel(h)}`;
  const studRowCentre = -depth / 2 + studRows / 2;
  return {
    id: spec.id ?? `slope${angle}-${depth}x${width}${tall}${inverted ? '-inv' : ''}`,
    name: `Slope ${angle}° ${depth} × ${width}${tallName}${inverted ? ' Inverted' : ''}`,
    category: 'slopes',
    w: width,
    d: depth,
    h,
    studs: inverted ? studGrid(width, depth) : studGrid(width, depth, (_x, z) => z < studRows),
    solids: [fullBox(width, depth, h)],
    shape: { kind: 'slope', run, inverted },
    ldraw: ldraw(spec.file, spec.origin ?? [0, h * PLATE_HEIGHT, studRowCentre]),
    keywords: ['slope', 'roof', ...(inverted ? ['inverted'] : []), ...(spec.keywords ?? [])],
  };
}

function round(kind: 'Plate' | 'Brick' | 'Tile', size: number, file: string): PartDef {
  const h = kind === 'Brick' ? BRICK : PLATE;
  return {
    id: `round-${kind.toLowerCase()}-${size}x${size}`,
    name: `${kind} ${size} × ${size} Round`,
    category: 'round',
    w: size,
    d: size,
    h,
    studs: kind === 'Tile' ? [] : studGrid(size, size),
    solids: [fullBox(size, size, h)],
    shape: { kind: 'round', profile: 'cylinder' },
    ldraw: ldraw(file, topCentre(h)),
    keywords: ['round', 'cylinder', ...(kind === 'Tile' ? ['dot', 'flat'] : [])],
  };
}

function archSolids(w: number, h: number, span: number, rise: number): CellBox[] {
  const curve = archCurve(span, rise);
  const leg = (w - span) / 2;
  const boxes: CellBox[] = [
    { x0: 0, y0: 0, z0: 0, x1: leg, y1: h, z1: 1 },
    { x0: w - leg, y0: 0, z0: 0, x1: w, y1: h, z1: 1 },
  ];
  for (let x = leg; x < w - leg; x++) {
    const underside = archHeightAt(curve, x + 0.5 - w / 2);
    const firstSolid = Math.floor((underside + ARCH_TOLERANCE) / PLATE_HEIGHT);
    const y0 = Math.min(Math.max(firstSolid, 0), h - 1);
    boxes.push({ x0: x, y0, z0: 0, x1: x + 1, y1: h, z1: 1 });
  }
  return boxes;
}

function arch(length: number, bricksTall: number, span: number, risePlates: number, file: string): PartDef {
  const h = BRICK * bricksTall;
  const tall = bricksTall > 1;
  const rise = risePlates * PLATE_HEIGHT;
  return {
    id: `arch-1x${length}${tall ? `x${bricksTall}` : ''}`,
    name: `Arch 1 × ${length}${tall ? ` × ${bricksTall}` : ''}`,
    category: 'arches',
    w: length,
    d: 1,
    h,
    studs: studGrid(length, 1),
    solids: archSolids(length, h, span, rise),
    shape: { kind: 'arch', span, rise },
    ldraw: ldraw(file, topCentre(h)),
    keywords: ['arch', 'window', 'bridge', 'door'],
  };
}

const CONE: PartDef = {
  id: 'cone-1x1',
  name: 'Cone 1 × 1',
  category: 'round',
  w: 1,
  d: 1,
  h: BRICK,
  studs: [[0, 0]],
  solids: [fullBox(1, 1, BRICK)],
  shape: { kind: 'round', profile: 'cone' },
  ldraw: ldraw('4589', topCentre(BRICK)),
  keywords: ['cone', 'round', 'tower'],
};

const BRICKS: readonly PartDef[] = [
  rectangular('Brick', 1, 1, '3005'),
  rectangular('Brick', 1, 2, '3004'),
  rectangular('Brick', 1, 3, '3622'),
  rectangular('Brick', 1, 4, '3010'),
  rectangular('Brick', 1, 6, '3009'),
  rectangular('Brick', 1, 8, '3008'),
  rectangular('Brick', 1, 10, '6111'),
  rectangular('Brick', 1, 12, '6112'),
  rectangular('Brick', 1, 16, '2465'),
  rectangular('Brick', 2, 2, '3003'),
  rectangular('Brick', 2, 3, '3002'),
  rectangular('Brick', 2, 4, '3001'),
  rectangular('Brick', 2, 6, '2456'),
  rectangular('Brick', 2, 8, '3007'),
  rectangular('Brick', 2, 10, '3006'),
  rectangular('Brick', 4, 6, '2356'),
  rectangular('Brick', 1, 1, '14716', 3),
  rectangular('Brick', 1, 2, '22886', 3),
  rectangular('Brick', 1, 1, '2453b', 5),
  rectangular('Brick', 1, 2, '2454a', 5),
];

const PLATES: readonly PartDef[] = [
  rectangular('Plate', 1, 1, '3024'),
  rectangular('Plate', 1, 2, '3023b'),
  rectangular('Plate', 1, 3, '3623'),
  rectangular('Plate', 1, 4, '3710'),
  rectangular('Plate', 1, 6, '3666'),
  rectangular('Plate', 1, 8, '3460'),
  rectangular('Plate', 1, 10, '4477'),
  rectangular('Plate', 1, 12, '60479'),
  rectangular('Plate', 2, 2, '3022'),
  rectangular('Plate', 2, 3, '3021'),
  rectangular('Plate', 2, 4, '3020'),
  rectangular('Plate', 2, 6, '3795'),
  rectangular('Plate', 2, 8, '3034'),
  rectangular('Plate', 2, 10, '3832'),
  rectangular('Plate', 2, 12, '2445'),
  rectangular('Plate', 2, 16, '4282'),
  rectangular('Plate', 3, 3, '11212'),
  rectangular('Plate', 4, 4, '3031'),
  rectangular('Plate', 4, 6, '3032'),
  rectangular('Plate', 4, 8, '3035'),
  rectangular('Plate', 4, 10, '3030'),
  rectangular('Plate', 4, 12, '3029'),
  rectangular('Plate', 6, 6, '3958'),
  rectangular('Plate', 6, 8, '3036'),
  rectangular('Plate', 6, 10, '3033'),
  rectangular('Plate', 6, 12, '3028'),
  rectangular('Plate', 6, 14, '3456'),
  rectangular('Plate', 6, 16, '3027'),
  rectangular('Plate', 8, 8, '41539'),
  rectangular('Plate', 8, 16, '92438'),
  rectangular('Plate', 16, 16, '91405'),
];

const TILES: readonly PartDef[] = [
  rectangular('Tile', 1, 1, '3070b'),
  rectangular('Tile', 1, 2, '3069b'),
  rectangular('Tile', 1, 3, '63864'),
  rectangular('Tile', 1, 4, '2431'),
  rectangular('Tile', 1, 6, '6636'),
  rectangular('Tile', 1, 8, '4162'),
  rectangular('Tile', 2, 2, '3068b'),
  rectangular('Tile', 2, 3, '26603'),
  rectangular('Tile', 2, 4, '87079'),
  rectangular('Tile', 2, 6, '69729'),
];

const SLOPES: readonly PartDef[] = [
  slope({ angle: 45, depth: 2, width: 1, h: BRICK, run: 1, file: '3040b' }),
  slope({ angle: 45, depth: 2, width: 2, h: BRICK, run: 1, file: '3039' }),
  slope({ angle: 45, depth: 2, width: 3, h: BRICK, run: 1, file: '3038' }),
  slope({ angle: 45, depth: 2, width: 4, h: BRICK, run: 1, file: '3037' }),
  slope({ angle: 33, depth: 3, width: 1, h: BRICK, run: 2, file: '4286' }),
  slope({ angle: 33, depth: 3, width: 2, h: BRICK, run: 2, file: '3298' }),
  slope({ angle: 33, depth: 3, width: 3, h: BRICK, run: 2, file: '4161' }),
  slope({ angle: 33, depth: 3, width: 4, h: BRICK, run: 2, file: '3297' }),
  slope({ angle: 65, depth: 2, width: 1, h: 2 * BRICK, run: 1, file: '60481a' }),
  slope({ angle: 65, depth: 2, width: 2, h: 2 * BRICK, run: 1, file: '3678b' }),
  slope({
    angle: 30, depth: 1, width: 1, h: 2, run: 1, file: '54200', id: 'slope30-1x1',
    origin: [0, 0, 0], keywords: ['cheese', 'wedge'],
  }),
  slope({
    angle: 30, depth: 1, width: 2, h: 2, run: 1, file: '85984', id: 'slope30-1x2',
    origin: [0, 0, 0], keywords: ['cheese', 'wedge'],
  }),
  slope({ angle: 45, depth: 2, width: 1, h: BRICK, run: 1, inverted: true, file: '3665b' }),
  slope({ angle: 45, depth: 2, width: 2, h: BRICK, run: 1, inverted: true, file: '3660b' }),
  slope({ angle: 33, depth: 3, width: 2, h: BRICK, run: 2, inverted: true, file: '3747b' }),
];

const ROUND: readonly PartDef[] = [
  round('Plate', 1, '6141'),
  round('Brick', 1, '3062b'),
  round('Tile', 1, '98138'),
  round('Plate', 2, '4032b'),
  round('Brick', 2, '3941'),
  round('Tile', 2, '14769'),
  CONE,
];

const ARCHES: readonly PartDef[] = [
  arch(4, 1, 2, 2, '3659'),
  arch(6, 1, 4, 2, '3455'),
  arch(6, 2, 4, 5, '3307'),
  arch(8, 2, 6, 5, '3308a'),
];

export const PARTS: readonly PartDef[] = [
  ...BRICKS,
  ...PLATES,
  ...TILES,
  ...SLOPES,
  ...ROUND,
  ...ARCHES,
];

export const DEFAULT_PART_ID = 'brick-2x4';

const BY_ID: ReadonlyMap<string, PartDef> = new Map(PARTS.map((p) => [p.id, p]));

/** Parts from the LDraw library, known once its index has loaded. */
let libraryParts: ReadonlyMap<string, PartDef> = new Map();

/** Makes library parts known to getPart. Built-in ids always win. */
export function registerLibraryParts(parts: readonly PartDef[]): void {
  const added = parts.filter((p) => !BY_ID.has(p.id)).map((p) => [p.id, p] as const);
  libraryParts = new Map([...libraryParts, ...added]);
}

export function getPart(id: string): PartDef | undefined {
  return BY_ID.get(id) ?? libraryParts.get(id);
}

/** Lower-cases text and writes sizes the same way ("2 × 4", "2 x 4" → "2x4"). */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/°/g, '')
    .replace(/(\d)\s*x\s*(?=\d)/g, '$1x')
    .trim();
}

/** Everything a search may match for a part, normalised. */
export function searchTextOf(part: PartDef): string {
  return normalizeSearchText([part.name, part.id, part.ldraw?.file.replace(/\.dat$/, '') ?? '', ...part.keywords].join(' '));
}

/** Splits a query into normalised words that must all match. */
export function searchTokens(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

const SIZE_TOKEN = /^\d+(?:x\d+)+$/;

/**
 * Whether a normalised text contains a query word. Sizes match whole
 * numbers only, so "1x2" finds "1x2" and "1x2x3" but not "11x23" or "1x20".
 */
export function containsToken(haystack: string, token: string): boolean {
  if (!SIZE_TOKEN.test(token)) return haystack.includes(token);
  let at = haystack.indexOf(token);
  while (at !== -1) {
    const before = haystack[at - 1] ?? '';
    const after = haystack[at + token.length] ?? '';
    if (!/[\d.]/.test(before) && !/\d/.test(after)) return true;
    at = haystack.indexOf(token, at + 1);
  }
  return false;
}

const HAYSTACKS: ReadonlyMap<string, string> = new Map(
  PARTS.map((p) => [p.id, searchTextOf(p)]),
);

/** Finds parts whose name, size, LDraw number or keywords contain every query word. */
export function searchParts(query: string, category?: PartCategory): PartDef[] {
  const tokens = searchTokens(query);
  return PARTS.filter((part) => {
    if (category && part.category !== category) return false;
    const haystack = HAYSTACKS.get(part.id) ?? '';
    return tokens.every((token) => containsToken(haystack, token));
  });
}
