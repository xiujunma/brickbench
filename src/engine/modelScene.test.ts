import { Group, Mesh, MeshPhysicalMaterial, Object3D } from 'three';
import { describe, expect, it } from 'bun:test';
import { getPart } from '../core/parts/catalog';
import type { Brick } from '../core/model/types';
import { GeometryCache } from './geometryCache';
import { MaterialLibrary } from './materials';
import { modelGroup } from './modelScene';
import { castsNoOcclusion, castsOcclusion } from './occlusionMark';

const brick = (id: string, partId: string, colorId: number, x: number): Brick => ({ id, partId, colorId, x, y: 0, z: 0, r: 0 });

describe('the model as plain meshes', () => {
  it('gives each brick a node of its own, sharing a mesh per part, placed where the brick is', () => {
    const geometries = new GeometryCache(getPart);
    const group = modelGroup([brick('a', 'brick-2x4', 4, 0), brick('b', 'brick-2x4', 1, 6), brick('c', 'nope', 4, 0)], getPart, geometries, new MaterialLibrary());
    expect(group.children.map((node) => node.name)).toEqual(['Brick 2 × 4 · Red', 'Brick 2 × 4 · Blue']);
    const [first, second] = group.children as Mesh[];
    expect(first?.geometry).toBe(second?.geometry as never);
    expect(second!.position.x - first!.position.x).toBeCloseTo(6, 6);
    geometries.dispose();
  });

  it('takes the materials it is given, as photos do for glass', () => {
    const glass = new MeshPhysicalMaterial({ transmission: 1 });
    const group = modelGroup([brick('a', 'plate-1x1', 47, 0)], getPart, new GeometryCache(getPart), new MaterialLibrary(), () => glass);
    expect((group.children[0] as Mesh).material).toBe(glass);
    expect(group).toBeInstanceOf(Group);
  });
});

describe('objects that darken nothing', () => {
  it('are marked, with everything else casting ambient occlusion', () => {
    const outline = new Object3D();
    expect(castsOcclusion(outline)).toBe(true);
    castsNoOcclusion(outline);
    expect(castsOcclusion(outline)).toBe(false);
  });
});
