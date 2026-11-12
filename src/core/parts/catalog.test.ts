import { describe, expect, it } from 'bun:test';
import { DEFAULT_PART_ID, PARTS, PART_CATEGORIES, containsToken, getPart, searchParts } from './catalog';
import type { PartDef } from './types';

function isCovered(part: PartDef, x: number, y: number, z: number): boolean {
  return part.solids.some(
    (b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && z >= b.z0 && z < b.z1,
  );
}

describe('part catalogue', () => {
  it('has unique ids', () => {
    const ids = PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has parts in every category', () => {
    for (const category of PART_CATEGORIES) {
      expect(PARTS.some((p) => p.category === category.id)).toBe(true);
    }
  });

  it('uses positive whole-number sizes', () => {
    for (const part of PARTS) {
      for (const n of [part.w, part.d, part.h]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });

  it('keeps studs inside the footprint without duplicates', () => {
    for (const part of PARTS) {
      const keys = part.studs.map(([x, z]) => `${x},${z}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const [x, z] of part.studs) {
        expect(x >= 0 && x < part.w && z >= 0 && z < part.d).toBe(true);
      }
    }
  });

  it('keeps solids inside the bounding box', () => {
    for (const part of PARTS) {
      expect(part.solids.length).toBeGreaterThan(0);
      for (const box of part.solids) {
        expect(box.x0).toBeGreaterThanOrEqual(0);
        expect(box.y0).toBeGreaterThanOrEqual(0);
        expect(box.z0).toBeGreaterThanOrEqual(0);
        expect(box.x1).toBeLessThanOrEqual(part.w);
        expect(box.y1).toBeLessThanOrEqual(part.h);
        expect(box.z1).toBeLessThanOrEqual(part.d);
        expect(box.x1 > box.x0 && box.y1 > box.y0 && box.z1 > box.z0).toBe(true);
      }
    }
  });

  it('gives tiles no studs', () => {
    for (const part of PARTS.filter((p) => p.category === 'tiles')) {
      expect(part.studs).toHaveLength(0);
    }
  });

  it('names LDraw files consistently', () => {
    for (const part of PARTS) {
      if (part.ldraw) expect(part.ldraw.file).toMatch(/^[0-9a-z]+\.dat$/);
    }
  });

  it('finds parts by id', () => {
    expect(getPart(DEFAULT_PART_ID)?.name).toBe('Brick 2 × 4');
    expect(getPart('no-such-part')).toBeUndefined();
  });

  it('lays out bricks with the long side along X', () => {
    const brick = getPart('brick-2x4');
    expect(brick).toMatchObject({ w: 4, d: 2, h: 3 });
    expect(brick?.studs).toHaveLength(8);
  });

  it('leaves the arch opening free at the bottom', () => {
    const arch = getPart('arch-1x4');
    if (!arch) throw new Error('arch-1x4 missing');
    expect(isCovered(arch, 0, 0, 0)).toBe(true);
    expect(isCovered(arch, 3, 0, 0)).toBe(true);
    expect(isCovered(arch, 1, 0, 0)).toBe(false);
    expect(isCovered(arch, 2, 0, 0)).toBe(false);
    expect(isCovered(arch, 1, 2, 0)).toBe(true);
  });

  it('puts slope studs only on the high back row', () => {
    const slope = getPart('slope45-2x2');
    expect(slope?.studs).toHaveLength(2);
    expect(slope?.studs.every(([, z]) => z === 0)).toBe(true);
    expect(getPart('slope45-2x2-inv')?.studs).toHaveLength(4);
  });

  it('searches by name, size and LDraw number', () => {
    expect(searchParts('2x4').map((p) => p.id)).toContain('brick-2x4');
    expect(searchParts('plate 2 x 4').map((p) => p.id)).toContain('plate-2x4');
    expect(searchParts('3001').map((p) => p.id)).toEqual(['brick-2x4']);
    expect(searchParts('cheese').map((p) => p.id)).toContain('slope30-1x1');
    const slopes = searchParts('slope', 'slopes');
    expect(slopes.length).toBeGreaterThan(5);
    expect(slopes.every((p) => p.category === 'slopes')).toBe(true);
    expect(searchParts('', 'tiles').every((p) => p.category === 'tiles')).toBe(true);
    expect(searchParts('nothing-matches-this')).toEqual([]);
  });

  it('matches sizes on whole numbers only', () => {
    expect(searchParts('1x1').map((p) => p.id)).not.toContain('brick-1x16');
    expect(containsToken('brick 1x2x3', '1x2')).toBe(true);
    expect(containsToken('panel 11x23', '1x2')).toBe(false);
    expect(containsToken('plate 1x20', '1x2')).toBe(false);
    expect(containsToken('slope 1x2 and 11x2', '1x2')).toBe(true);
    expect(containsToken('slope 0.5x1', '5x1')).toBe(false);
    expect(containsToken('technic 32000', '3200')).toBe(true);
  });
});
