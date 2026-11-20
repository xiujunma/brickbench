import { describe, expect, it } from 'bun:test';
import { Color, type InstancedMesh } from 'three';
import { toPartDef } from '../core/ldraw/catalogIndex';
import type { PartMesh } from '../core/ldraw/format';
import type { Brick } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import type { PartLookup } from '../core/parts/types';
import { BrickBatches } from './brickBatches';
import { GeometryCache } from './geometryCache';
import { MaterialLibrary, OUTLINE_RENDER_ORDER, colorHex, highlightFor } from './materials';
import type { MeshSource } from './meshStore';

const WHEEL = toPartDef({ id: 'wheel', name: 'Wheel with Tyre', category: 'Wheel', w: 2, d: 2, h: 3, origin: [0, 1.2, 0], snug: true });
const lookup: PartLookup = (id) => (id === WHEEL.id ? WHEEL : getPart(id));

/** A rim in the brick's colour, a tyre in black (in the app's palette) and a hub cap in a colour it is not. */
const MESH: PartMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0.5, 0.5, 0.5]),
  normals: new Float32Array(27).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
  indices: new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  layers: [
    { start: 0, count: 3, code: 16, hex: '#ffffff', finish: 'solid' },
    { start: 3, count: 3, code: 0, hex: '#1b2a34', finish: 'solid' },
    { start: 6, count: 3, code: 494, hex: '#d0d0d0', finish: 'pearl' },
  ],
};

const source: MeshSource = { request: () => MESH, load: async () => MESH, subscribe: () => () => undefined, onRetry: () => () => undefined };
const brick = (id: string, colorId: number, x: number): Brick => ({ id, partId: WHEEL.id, colorId, x, y: 0, z: 0, r: 0 });

function colourOf(mesh: InstancedMesh, instance: number): string {
  const color = new Color();
  mesh.getColorAt(instance, color);
  return `#${color.getHexString()}`;
}

describe('BrickBatches with parts drawn in several colours', () => {
  it('draws each colour a part fixes in its own batch, whatever colour the bricks are', () => {
    const geometries = new GeometryCache(lookup, source);
    const batches = new BrickBatches(geometries, new MaterialLibrary(), lookup);
    batches.update([brick('a', 4, 0), brick('b', 1, 4)], []);
    const meshes = batches.group.children as InstancedMesh[];
    const layers = geometries.layers(WHEEL.id);
    const tyre = meshes.find((mesh) => mesh.geometry === layers[0]?.geometry);
    const cap = meshes.find((mesh) => mesh.geometry === layers[1]?.geometry);
    const rim = meshes.find((mesh) => mesh.geometry === geometries.body(WHEEL.id));
    // the rim takes each brick's colour; the tyre is the palette's black and the cap the part's own grey
    expect([colourOf(rim as InstancedMesh, 0), colourOf(rim as InstancedMesh, 1)]).toEqual([colorHex(4).toLowerCase(), colorHex(1).toLowerCase()]);
    expect(tyre?.count).toBe(2);
    expect(colourOf(tyre as InstancedMesh, 1)).toBe(colorHex(0).toLowerCase());
    expect(colourOf(cap as InstancedMesh, 0)).toBe('#d0d0d0');

    batches.update([brick('a', 4, 0)], []);
    expect(tyre?.count).toBe(1);
    batches.clear();
    expect(batches.group.children).toHaveLength(0);
  });

  it('adds the layers of meshes that load after the bricks were drawn', () => {
    let loaded: PartMesh | null = null;
    const listeners = new Set<(partId: string, mesh: PartMesh) => void>();
    const late: MeshSource = { request: () => loaded, load: async () => MESH, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)), onRetry: () => () => undefined };
    const geometries = new GeometryCache(lookup, late);
    const batches = new BrickBatches(geometries, new MaterialLibrary(), lookup);
    batches.update([brick('a', 4, 0)], []);
    expect(batches.group.children).toHaveLength(1);
    loaded = MESH;
    for (const listener of listeners) listener(WHEEL.id, MESH);
    batches.refreshParts();
    expect(batches.group.children).toHaveLength(3);
  });
});

describe('BrickBatches looks', () => {
  const outlines = (batches: BrickBatches) => batches.group.children.filter((child) => child.renderOrder === OUTLINE_RENDER_ORDER) as InstancedMesh[];

  it('outlines bricks in the looks that call for it, even after a redraw in another look', () => {
    const batches = new BrickBatches(new GeometryCache(lookup, source), new MaterialLibrary(), lookup, 'selected');
    batches.update([brick('a', 4, 0)], [{ x: 0.5, y: 1.2, z: 0.5, r: 0, colorId: 4 }]);
    expect(outlines(batches)).toHaveLength(1);
    batches.setOutlineWidth(0.08);
    // a picture is taken without the selection look, and a mesh arriving meanwhile redraws the bricks
    batches.setLook('resting');
    batches.refreshParts();
    expect(outlines(batches)).toHaveLength(0);
    batches.setLook('selected');
    expect(outlines(batches)).toHaveLength(1);
    batches.dispose();
    expect(batches.group.children).toHaveLength(0);
  });

  it('outlines highlighted bricks in a colour that stands out from theirs, and draws invalid ghosts plain', () => {
    const geometries = new GeometryCache(lookup, source);
    const batches = new BrickBatches(geometries, new MaterialLibrary(), lookup, 'highlight');
    batches.update([brick('a', 4, 0), brick('b', 1, 4)], []);
    const [outline] = outlines(batches);
    expect(outline?.count).toBe(2);
    expect(colourOf(outline as InstancedMesh, 0)).toBe(highlightFor(4).toLowerCase());
    batches.setLook('ghost-invalid');
    batches.update([brick('a', 4, 0)], []);
    const tyre = batches.group.children.find((child) => (child as InstancedMesh).geometry === geometries.layers(WHEEL.id)[0]?.geometry);
    expect(colourOf(tyre as InstancedMesh, 0)).toBe('#ffffff');
    expect(outlines(batches)).toHaveLength(0);
  });
});
