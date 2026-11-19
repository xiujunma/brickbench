import { describe, expect, it } from 'bun:test';
import { fitPart } from './fit.ts';
import { buildMesh } from './mesh.ts';
import type { V3 } from './parse.ts';
import { displayName, exclusionReason, isPrintedPart, readHeader } from './select.ts';

type Tri = { a: V3; b: V3; c: V3; doubleSided?: boolean };

/** Twelve triangles of a closed unit cube, wound counter-clockwise from outside. */
function cube(): Tri[] {
  const v: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  return quads.flatMap(([a = 0, b = 0, c = 0, d = 0]) => [
    { a: v[a] as V3, b: v[b] as V3, c: v[c] as V3 },
    { a: v[a] as V3, b: v[c] as V3, c: v[d] as V3 },
  ]);
}

/** The side band of an n-sided cylinder of radius 1 and height 1. */
function cylinderSide(n: number): Tri[] {
  const at = (i: number, y: number): V3 => [Math.cos((i / n) * Math.PI * 2), y, Math.sin((i / n) * Math.PI * 2)];
  return Array.from({ length: n }, (_, i) => [
    { a: at(i, 0), b: at(i, 1), c: at(i + 1, 1) },
    { a: at(i, 0), b: at(i + 1, 1), c: at(i + 1, 0) },
  ]).flat();
}

describe('buildMesh', () => {
  it('keeps the edges of a box sharp', () => {
    const mesh = buildMesh(cube());
    expect(mesh.indices.length).toBe(36);
    expect(mesh.positions.length / 3).toBe(24);
  });

  it('smooths shallow angles such as a cylinder wall', () => {
    const mesh = buildMesh(cylinderSide(16));
    expect(mesh.positions.length / 3).toBe(32);
    // normals point straight out from the axis
    const [nx = 0, ny = 0, nz = 0] = mesh.normals;
    const [px = 0, , pz = 0] = mesh.positions;
    expect(nx * px + nz * pz).toBeCloseTo(1, 2);
    expect(ny).toBeCloseTo(0, 5);
  });

  it('adds a back face for double-sided triangles and drops degenerate ones', () => {
    const mesh = buildMesh([
      { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], doubleSided: true },
      { a: [0, 0, 0], b: [1, 0, 0], c: [2, 0, 0] },
    ]);
    expect(mesh.indices.length).toBe(6);
  });
});

describe('fitPart', () => {
  it('centres a 2 × 4 brick on its footprint, standing on y = 0', () => {
    const fit = fitPart([-2, -1.2, -1], [2, 0, 1], [[-1.5, 0, -0.5], [0.5, 0, 0.5]]);
    expect(fit).toMatchObject({ w: 4, d: 2, h: 3, snug: true });
    expect(fit.offset).toEqual([0, 1.2, 0]);
  });

  it('nudges a slightly lopsided body so its studs land on cell centres', () => {
    // a 1 × 2 body with a 0.1 stud lip on one side: centring the box would put studs off the grid
    const fit = fitPart([-1, 0, -0.5], [1.1, 0.4, 0.5], [[-0.5, 0.4, 0], [0.5, 0.4, 0]]);
    expect(fit.w).toBe(2);
    expect(fit.offset[0]).toBeCloseTo(0, 5);
  });

  it('leaves half-offset studs alone, as on a jumper plate', () => {
    const fit = fitPart([-1, 0, -0.5], [1, 0.4, 0.5], [[0, 0.4, 0]]);
    expect(fit.offset[0]).toBeCloseTo(0, 5);
  });

  it('flags bodies that do not land on whole studs and plates, giving tall tops another plate', () => {
    const fit = fitPart([-0.6, 0, -0.6], [0.6, 1.35, 0.6], []);
    expect(fit.snug).toBe(false);
    expect(fit.w).toBe(1);
    // 3.375 plates: more than a quarter plate over three
    expect(fit.h).toBe(4);
  });

  it('gives a body that sticks out more than a little the next cell, keeping its stud on the grid', () => {
    // a 1 × 1 brick with a clip reaching 0.3 stud beyond one side
    const fit = fitPart([-0.5, 0, -0.5], [0.8, 1.2, 0.5], [[0, 1.2, 0]]);
    expect([fit.w, fit.d]).toEqual([2, 1]);
    // the stud lands on the centre of the first cell
    expect(fit.offset[0] + 0).toBeCloseTo(-0.5, 5);
    expect(fit.snug).toBe(false);
  });

  it('takes a wider footprint rather than leave a centred stud between cells', () => {
    // a 1.6-wide flange around one stud: two cells would put the stud on a cell edge
    const fit = fitPart([-0.8, 0, -0.8], [0.8, 0.4, 0.8], [[0, 0.4, 0]]);
    expect([fit.w, fit.d]).toEqual([3, 3]);
    expect(fit.offset[0]).toBeCloseTo(0, 5);
  });

  it('lets small overhangs and tops stay in their cells', () => {
    const fit = fitPart([-0.65, 0, -0.5], [0.65, 1.28, 0.5], []);
    expect([fit.w, fit.d, fit.h]).toEqual([1, 1, 3]);
  });
});

describe('part headers', () => {
  const header = readHeader(
    ['0 Brick  2 x  4', '0 Name: 3001.dat', '0 Author: James Jessiman', '0 !LDRAW_ORG Part UPDATE 2004-03', '0 !CATEGORY Brick', '0 !KEYWORDS classic, basic', '0 !KEYWORDS wall'].join('\n'),
  );

  it('reads description, kind, category and keywords', () => {
    expect(header).toEqual({
      description: 'Brick  2 x  4', kind: 'Part', category: 'Brick', keywords: ['classic', 'basic', 'wall'], author: 'James Jessiman',
    });
  });

  it('names authors by real name, falling back to their user name', () => {
    expect(readHeader('0 Part\n0 Author: Jane Doe [jdoe]').author).toBe('Jane Doe');
    expect(readHeader('0 Part\n0 Author: [jdoe]').author).toBe('jdoe');
    expect(readHeader('0 Part').author).toBe('');
  });

  it('falls back to the first word of the description for the category', () => {
    expect(readHeader('0 Plate  1 x  2\n0 !LDRAW_ORG Part').category).toBe('Plate');
  });

  it('knows a printed part by its name, or a part with its stickers on by its category', () => {
    expect(isPrintedPart({ ...header, description: 'Tile 1 x 1 with Smile Pattern' })).toBe(true);
    expect(isPrintedPart({ ...header, description: 'Tile 2 x 4 with Tram Route Map', kind: 'Shortcut', category: 'Sticker Shortcut' })).toBe(true);
    expect(isPrintedPart({ ...header, description: 'Minifig Head Rodian without Pattern' })).toBe(false);
    expect(isPrintedPart(header)).toBe(false);
  });

  it('keeps plain and printed parts, and drops obsolete, alias, sticker and non-part files', () => {
    expect(exclusionReason(header)).toBeNull();
    expect(exclusionReason({ ...header, description: '~Moved to 3040b' })).toBe('obsolete');
    expect(exclusionReason({ ...header, description: '=Brick 2 x 4' })).toBe('alias');
    expect(exclusionReason({ ...header, description: '_Brick 2 x 4 Red' })).toBe('colour variant');
    expect(exclusionReason({ ...header, description: '| Hubelino 2 x 2 Track' })).toBe('third-party');
    expect(exclusionReason({ ...header, description: 'Tile 1 x 1 with Smile Pattern' })).toBeNull();
    expect(exclusionReason({ ...header, description: 'Slope 45 2 x 2 with Fire Logo Sticker', kind: 'Shortcut', category: 'Sticker Shortcut' })).toBeNull();
    expect(exclusionReason({ ...header, description: 'Sticker 1.9 x 1.9 with Fire Logo', category: 'Sticker' })).toBe('sticker');
    expect(exclusionReason({ ...header, kind: 'Subpart' })).toBe('not a part');
  });

  it('tidies names for display', () => {
    expect(displayName('Brick  2 x  4')).toBe('Brick 2 × 4');
    expect(displayName('Slope Brick 31  1 x  1 x  0.667')).toBe('Slope Brick 31 1 × 1 × 0.667');
  });
});
