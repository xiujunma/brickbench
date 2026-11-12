import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT, STUD_HEIGHT } from '../../core/grid';
import { PARTS, getPart } from '../../core/parts/catalog';
import type { PartDef } from '../../core/parts/types';
import { BRICK_GAP, buildBodyGeometry, buildPartGeometry, buildStudGeometry } from './partGeometry';
import { buildPath, roundedRect } from './path';

function part(id: string): PartDef {
  const found = getPart(id);
  if (!found) throw new Error(`missing part ${id}`);
  return found;
}

function bounds(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('no bounding box');
  return box;
}

function vertices(geometry: BufferGeometry): [number, number, number][] {
  const position = geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)]);
}

describe('part geometry', () => {
  it.each(PARTS.map((p) => [p.id, p] as const))('%s builds a clean mesh inside its footprint', (_id, def) => {
    const geometry = buildPartGeometry(def);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    expect(position.count).toBeGreaterThan(0);
    expect(index?.count ?? 0).toBeGreaterThan(0);
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(length).toBeCloseTo(1, 4);
      expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
    }
    const box = bounds(geometry);
    expect(box.min.x).toBeGreaterThanOrEqual(-def.w / 2);
    expect(box.max.x).toBeLessThanOrEqual(def.w / 2);
    expect(box.min.z).toBeGreaterThanOrEqual(-def.d / 2);
    expect(box.max.z).toBeLessThanOrEqual(def.d / 2);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.03);
    const top = def.h * PLATE_HEIGHT + (def.studs.length > 0 ? STUD_HEIGHT : 0);
    expect(box.max.y).toBeCloseTo(top, 5);
  });

  it('insets bodies by the seam gap', () => {
    const box = bounds(buildBodyGeometry(part('brick-2x4')));
    expect(box.max.x).toBeCloseTo(2 - BRICK_GAP, 5);
    expect(box.min.z).toBeCloseTo(-1 + BRICK_GAP, 5);
    expect(box.max.y).toBeCloseTo(3 * PLATE_HEIGHT, 5);
  });

  it('keeps the slope low at the front and high at the back', () => {
    const points = vertices(buildBodyGeometry(part('slope45-2x2')));
    const frontTop = Math.max(...points.filter(([, , z]) => z > 0.9).map(([, y]) => y));
    const backTop = Math.max(...points.filter(([, , z]) => z < -0.9).map(([, y]) => y));
    expect(frontTop).toBeLessThan(0.25);
    expect(backTop).toBeCloseTo(3 * PLATE_HEIGHT, 5);
  });

  it('leaves the arch opening empty', () => {
    const points = vertices(buildBodyGeometry(part('arch-1x4')));
    const inside = points.filter(([x, y]) => Math.abs(x) < 0.5 && y < 0.5);
    expect(inside).toEqual([]);
    const apex = Math.min(...points.filter(([x]) => Math.abs(x) < 0.05).map(([, y]) => y));
    expect(apex).toBeGreaterThan(0.75);
  });

  it('adds studs on top of the body', () => {
    const body = buildBodyGeometry(part('brick-2x2')).getAttribute('position').count;
    const full = buildPartGeometry(part('brick-2x2')).getAttribute('position').count;
    expect(full).toBeGreaterThan(body);
  });

  it('builds a stud standing on the origin', () => {
    const box = bounds(buildStudGeometry());
    expect(box.max.y).toBeCloseTo(STUD_HEIGHT, 5);
    expect(box.max.x).toBeCloseTo(0.3, 2);
  });
});

describe('buildPath', () => {
  it('rounds the corners of a rectangle with outward normals', () => {
    const path = buildPath(roundedRect(1, 0.5, 0.1), 2, true);
    expect(path).toHaveLength(12);
    for (const p of path) {
      expect(p.u * p.nu + p.v * p.nv).toBeGreaterThan(0);
      expect(Math.abs(p.u)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(p.v)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('keeps end points of open paths and creases sharp corners', () => {
    const path = buildPath(
      [
        { u: 0, v: 0 },
        { u: 1, v: 0, mode: 'sharp' },
        { u: 1, v: 1 },
      ],
      2,
      false,
    );
    expect(path).toHaveLength(4);
    expect(path[1]).toMatchObject({ u: 1, v: 0 });
    expect(path[2]).toMatchObject({ u: 1, v: 0 });
    expect(path[1]?.nv).toBeCloseTo(-1);
    expect(path[2]?.nu).toBeCloseTo(1);
  });
});
