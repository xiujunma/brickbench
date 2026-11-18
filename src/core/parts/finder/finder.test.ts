import { describe, expect, it } from 'bun:test';
import type { LDrawIndexEntry } from '../../ldraw/format';
import { PARTS } from '../catalog';
import { createFinder } from './finder';

/** Real LDraw names and sizes, including copies of two built-in parts (3001, 54200). */
const COPIES = 2;
const entry = (id: string, name: string, category: string, w: number, d: number, h: number, keywords?: string[]): LDrawIndexEntry => ({
  id,
  name,
  category,
  w,
  d,
  h,
  origin: [0, 0, 0],
  snug: true,
  ...(keywords ? { keywords } : {}),
});

const LIBRARY: readonly LDrawIndexEntry[] = [
  entry('3001', 'Brick 2 × 4', 'Brick', 4, 2, 3),
  entry('54200', 'Slope Brick 31 1 × 1 × 0.667', 'Slope', 1, 1, 2),
  entry('7827', 'Slope Brick 31 1 × 1 × 0.667 Double Concave', 'Slope', 1, 1, 2),
  entry('3794b', 'Plate 1 × 2 with Groove with 1 Centre Stud', 'Plate', 2, 1, 1),
  // its clip sticks out, so on the grid it takes 1 × 2 cells and two plates
  entry('61252', 'Plate 1 × 1 with Clip Horizontal (Thick C-Clip)', 'Plate', 2, 1, 2),
  entry('3245c', 'Brick 1 × 2 × 2 without Understud', 'Brick', 2, 1, 6),
  entry('60470', 'Plate 1 × 2 with 2 Clips Horizontal', 'Plate', 2, 1, 1),
  entry('4070', 'Brick 1 × 1 with Headlight', 'Brick', 1, 1, 3),
  entry('3063b', 'Brick 2 × 2 Corner Round with Stud Notch', 'Brick', 2, 2, 3),
  entry('32000', 'Technic Brick 1 × 2 with Holes', 'Technic', 2, 1, 3),
  entry('18654', 'Technic Beam 1', 'Technic', 1, 1, 3),
  entry('3647', 'Duplo Axle Connector', 'Technic', 2, 1, 3),
  entry('3641', 'Tyre 6/50 × 8 Offset Tread', 'Tyre', 1, 1, 2),
  entry('2412b', 'Tile 1 × 2 Grille with Groove', 'Tile', 2, 1, 1),
  entry('3937', 'Hinge 1 × 2 Base', 'Hinge', 2, 1, 2, ['swivel']),
  entry('2437', 'Windscreen 3 × 4 × 1.333', 'Windscreen', 4, 3, 4),
  entry('3626c', 'Minifig Head with Hollow Stud', 'Minifig', 1, 1, 3, ['BrickLink 3626']),
];

const finder = createFinder(PARTS, LIBRARY);
const ids = (query: string, filters?: Parameters<typeof finder.find>[1]) => finder.find(query, filters).items.map((i) => i.partId);

describe('finding parts', () => {
  it('searches built-in and library parts together, built-in first, without library copies', () => {
    const found = ids('brick 2x4');
    expect(found[0]).toBe('brick-2x4');
    expect(found).not.toContain('ldraw:3001');
    expect(ids('', { source: 'library' })).toContain('ldraw:3001');
    expect(finder.count).toBe(PARTS.length + LIBRARY.length - COPIES);
  });

  it('looks parts up by id, library copies included', () => {
    expect(finder.get('ldraw:3001')).toMatchObject({ name: 'Brick 2 × 4', source: 'library' });
    expect(finder.get('brick-2x4')?.source).toBe('basic');
    expect(finder.get('ldraw:nope')).toBeUndefined();
  });

  it('understands sizes typed any way', () => {
    expect(ids('two by four brick')[0]).toBe('brick-2x4');
    expect(ids('Brick 2 X 4')[0]).toBe('brick-2x4');
    expect(ids('plates 1 by 2')[0]).toBe('plate-1x2');
  });

  it('puts the part with a typed number first, including BrickLink numbers', () => {
    expect(ids('3001')[0]).toBe('brick-2x4');
    expect(ids('32000')).toEqual(['ldraw:32000']);
    expect(ids('3626')).toEqual(['ldraw:3626c']);
  });

  it('knows hobby nicknames', () => {
    expect(ids('cheese')).toEqual(['slope30-1x1', 'slope30-1x2', 'ldraw:7827']);
    expect(ids('jumper')).toEqual(['ldraw:3794b']);
    expect(ids('macaroni')).toEqual(['ldraw:3063b']);
    expect(ids('erling')).toEqual(['ldraw:4070']);
    expect(ids('liftarm')).toEqual(['ldraw:18654']);
    expect(ids('snot')).toContain('ldraw:4070');
  });

  it('accepts US spellings and other words for things', () => {
    expect(ids('tire')).toEqual(['ldraw:3641']);
    expect(ids('windshield')).toEqual(['ldraw:2437']);
    expect(ids('grill')).toEqual(['ldraw:2412b']);
    expect(ids('swivel')).toContain('ldraw:3937');
  });

  it('falls back to close spellings when nothing matches as typed', () => {
    const exact = finder.find('hinge');
    expect(exact.fuzzy).toBe(false);
    const typo = finder.find('hnige');
    expect(typo.fuzzy).toBe(true);
    expect(typo.items.map((i) => i.partId)).toContain('ldraw:3937');
    expect(finder.find('brcik 2x4').items[0]?.partId).toBe('brick-2x4');
    expect(finder.find('zzzzzz')).toEqual({ items: [], fuzzy: false });
  });

  it('prefers names where the words come early', () => {
    const sized = createFinder([], [
      entry('bracket', 'Bracket 1 × 2 - 2 × 4', 'Bracket', 2, 4, 1),
      entry('tile', 'Tile 2 × 4', 'Tile', 4, 2, 1),
      entry('brick', 'Brick 2 × 4', 'Brick', 4, 2, 3),
    ]);
    // equal places keep library order; the bracket's 2 × 4 is its fourth word
    expect(sized.find('2x4').items.map((i) => i.number)).toEqual(['tile', 'brick', 'bracket']);
  });

  it('finds sizes typed either way round', () => {
    expect(ids('brick 4x2')[0]).toBe('brick-2x4');
    expect(ids('four by two plate')[0]).toBe('plate-2x4');
    expect(ids('tile 2x1')).toContain('tile-1x2');
    expect(ids('lego brick 2x4')[0]).toBe('brick-2x4');
  });

  it('puts the everyday parts first for a size alone', () => {
    expect(ids('2x4')).toEqual(['brick-2x4', 'plate-2x4', 'tile-2x4', 'slope45-2x4']);
  });

  it('prefers whole words to words found inside others', () => {
    const pins = createFinder([], [
      entry('spindle', 'Turntable Spindle', 'Turntable', 1, 1, 1),
      entry('pin', 'Technic Axle Pin with Friction', 'Technic', 2, 1, 1),
    ]);
    expect(pins.find('pin').items.map((i) => i.number)).toEqual(['pin', 'spindle']);
    // synonyms only start words: "peg" finds the pin, not the spindle
    expect(pins.find('peg').items.map((i) => i.number)).toEqual(['pin']);
  });

  it('ranks names that start with the query, then names with every word', () => {
    const found = ids('plate 1x2');
    expect(found[0]).toBe('plate-1x2');
    expect(found.indexOf('ldraw:3794b')).toBeGreaterThan(0);
    // "brick 1x1" starts "Brick 1 × 1 Round" but not "Brick 1 × 1 × 3", whose size is another
    const ones = ids('brick 1x1');
    expect(ones[0]).toBe('brick-1x1');
    expect(ones.indexOf('round-brick-1x1')).toBeLessThan(ones.indexOf('brick-1x1x3'));
    expect(ones).not.toContain('brick-1x10');
  });

  it('reads plurals by their endings', () => {
    expect(ids('hinges')).toContain('ldraw:3937');
    expect(ids('clips', { footprint: '1x2' })).toEqual(['ldraw:60470']);
  });

  it('does not read a size out of a longer one', () => {
    expect(ids('2x2')).not.toContain('ldraw:3245c');
    // either way round: Slope 65° 2 × 1 × 2 is 1 × 2 × 2 too
    expect(ids('1x2x2')).toEqual(['slope65-2x1x2', 'ldraw:3245c']);
  });

  it('keeps hidden ids out of the search', () => {
    // every library part's id starts "ldraw:"
    expect(finder.find('draw')).toEqual({ items: [], fuzzy: false });
  });

  it('treats odd words as plain text', () => {
    expect(() => finder.find('constructor __proto__ toString')).not.toThrow();
    expect(finder.find('constructor').items).toEqual([]);
  });

  it('says the filters ruled the parts out rather than guessing at spellings', () => {
    const rails = createFinder([], [
      entry('tail', 'Tail 4 × 1 × 3', 'Tail', 4, 1, 9),
      entry('rail', 'Plate 1 × 2 with Rail', 'Plate', 2, 1, 1),
    ]);
    // "tail" is spelt right, so the rail one typo away is no answer
    expect(rails.find('tail', { height: 'plate' })).toEqual({ items: [], fuzzy: false });
    expect(rails.find('tial').fuzzy).toBe(true);
  });
});

describe('filtering parts', () => {
  it('narrows by footprint either way round, height and feature', () => {
    expect(ids('', { footprint: '1x2', feature: 'clip' })).toEqual(['ldraw:60470']);
    const flat1x2 = ids('', { footprint: '1x2', height: 'plate' });
    expect(flat1x2).toContain('plate-1x2');
    expect(flat1x2).toContain('ldraw:2412b');
    expect(flat1x2).not.toContain('brick-1x2');
    expect(ids('', { feature: 'side-studs' })).toEqual(['ldraw:4070']);
    // axles count as connections too
    expect(ids('technic', { feature: 'holes' })).toEqual(['ldraw:32000', 'ldraw:3647']);
  });

  it('goes by the size and height in a part’s name, not the cells it takes', () => {
    expect(ids('', { footprint: '1x1', height: 'plate', feature: 'clip' })).toEqual(['ldraw:61252']);
    expect(ids('', { footprint: '1x2', feature: 'clip' })).not.toContain('ldraw:61252');
    expect(ids('', { footprint: '1x2', height: 'up-to-two-bricks' })).toContain('ldraw:3245c');
  });

  it('reads sizes from the part itself, not from what it comes with', () => {
    const hulls = createFinder([], [entry('hull', 'Boat Hull with 2 × 4 Cutout', 'Boat', 16, 8, 6)]);
    const sized = (footprint: string) => hulls.find('', { footprint }).items.map((i) => i.number);
    expect(sized('2x4')).toEqual([]);
    expect(sized('8x16')).toEqual(['hull']);
  });

  it('ignores a size in the name that cannot be the part’s own', () => {
    // a wheel rim's name gives millimetres; on the grid it takes 2 × 1 cells
    const rims = createFinder([], [entry('rim', 'Wheel Rim 11 × 18 with Hole', 'Wheel', 2, 1, 2)]);
    expect(rims.footprints().map((f) => f.key)).toEqual(['1x2']);
  });

  it('trusts the height a name gives only when the part is near it', () => {
    const tall = createFinder([], [
      entry('22885', 'Brick 1 × 2 × 1 2/3 with Studs on 1 Side', 'Brick', 2, 1, 5),
      entry('3245c', 'Brick 1 × 2 × 2 without Understud', 'Brick', 2, 1, 6),
    ]);
    const heights = (height: 'brick' | 'up-to-two-bricks') => tall.find('', { height }).items.map((i) => i.number);
    expect(heights('up-to-two-bricks')).toEqual(['22885', '3245c']);
    expect(heights('brick')).toEqual([]);
  });

  it('browses a library category with parts named after it first', () => {
    expect(ids('', { source: 'library', category: 'Technic' })).toEqual(['ldraw:32000', 'ldraw:18654', 'ldraw:3647']);
    expect(ids('', { source: 'basic', category: 'tiles' }).every((id) => id.startsWith('tile-') || id.includes('tile'))).toBe(true);
  });

  it('lists footprints, smallest first, either way round', () => {
    const footprints = finder.footprints(3);
    expect(footprints[0]).toMatchObject({ key: '1x1', label: '1 × 1' });
    const keys = footprints.map((f) => f.key);
    expect(keys.indexOf('1x2')).toBeLessThan(keys.indexOf('2x2'));
    expect(keys).not.toContain('2x1');
    expect(finder.footprints().length).toBeGreaterThan(footprints.length);
  });
});

describe('finding parts by part pattern', () => {
  it('reads a pattern for words, and says it did', () => {
    expect(finder.find('P2x4')).toMatchObject({ fuzzy: false, pattern: true });
    expect(ids('P2x4')).toEqual(['plate-2x4']);
    expect(finder.find('plate 2x4').pattern).toBeUndefined();
    expect(ids('S45[oo/..]')).toEqual(['slope45-2x2']);
    expect(ids('B1x(1|2)')).toEqual(['brick-1x1', 'brick-1x2', 'ldraw:4070']);
  });

  it('shows a library copy only when the pattern finds it and not the built-in part', () => {
    expect(ids('=3001')).toEqual(['brick-2x4']);
    expect(ids('@library =3001')).toEqual(['ldraw:3001']);
    expect(ids('+cheese')).toEqual(['slope30-1x1', 'slope30-1x2', 'ldraw:7827']);
  });

  it('keeps to the filters, and to the owned parts for @owned', () => {
    expect(ids('P', { source: 'library' })).toEqual(['ldraw:3794b', 'ldraw:61252', 'ldraw:60470']);
    expect(ids('P1x1 +clip', { height: 'plate' })).toEqual(['ldraw:61252']);
    expect(ids('@owned')).toEqual([]);
    expect(ids('@owned B', { ownedParts: new Set(['brick-2x4', 'plate-2x4']) })).toEqual(['brick-2x4']);
  });

  it('searches as words a query that looks like a pattern but does not read', () => {
    expect(finder.find('brick 1x1 (headlight)').pattern).toBeUndefined();
    expect(ids('brick 1x1 (headlight)')).toEqual(['ldraw:4070']);
  });

  it('gives any part it knows its canonical pattern', () => {
    expect(finder.patternOf('plate-2x4')).toBe('P[oooo]{2}=3020');
    expect(finder.patternOf('ldraw:61252')).toBe('P[##]=61252');
    expect(finder.patternOf('ldraw:3001')).toBe('B[####]{2}=3001');
    expect(finder.patternOf('nothing')).toBeUndefined();
  });
});
