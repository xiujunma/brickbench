import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { DEFAULT_COLOR_ID } from '../colors';
import { allBricks, modelFromBricks } from '../model/model';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import type { PartDef, PartLookup } from '../parts/types';
import { DEFAULT_SCENE, parseDocument, serializeDocument, type ModelDocument } from './modelFile';

function ids() {
  let n = 0;
  return () => `t${n++}`;
}

const doc: ModelDocument = {
  name: 'Tiny house',
  settings: { baseplateSize: 32, baseplateColor: 2 },
  model: modelFromBricks([
    makeBrick({ id: 'a' }),
    makeBrick({ id: 'b', partId: 'slope45-2x2', colorId: 15, x: -3, y: 3, z: 7, r: 3 }),
  ]),
};

describe('model files', () => {
  it('round-trips a document', () => {
    const result = parseDocument(serializeDocument(doc), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.warnings).toEqual([]);
    expect(result.value.doc.name).toBe('Tiny house');
    expect(result.value.doc.settings).toEqual(doc.settings);
    const strip = (b: Brick) => [b.partId, b.colorId, b.x, b.y, b.z, b.r];
    expect(allBricks(result.value.doc.model).map(strip)).toEqual(allBricks(doc.model).map(strip));
  });

  it('rejects text that is not JSON', () => {
    const result = parseDocument('{nope', getPart, ids());
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/i) });
  });

  it('rejects files from other apps', () => {
    const result = parseDocument(JSON.stringify({ format: 'other', bricks: [] }), getPart, ids());
    expect(result.ok).toBe(false);
  });

  it('rejects coordinates outside the grid', () => {
    const text = JSON.stringify({
      format: 'brickbench.model',
      version: 1,
      name: 'x',
      bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: -5, z: 0, r: 0 }],
    });
    expect(parseDocument(text, getPart, ids()).ok).toBe(false);
  });

  const file = (bricks: unknown[], settings?: unknown) =>
    JSON.stringify({ format: 'brickbench.model', version: 1, name: 'x', bricks, ...(settings ? { settings } : {}) });
  const record = (part: string, x: number, y: number, z: number) => ({ part, color: 4, x, y, z, r: 0 });

  it('keeps bricks half a stud over, side by side, and on any whole LDraw unit, but not between', () => {
    const halves = file([record('plate-1x2', 0.5, 0, -1.5), record('plate-1x2', 2.5, 0, -1.5), record('plate-1x2', 2, 0, -1.5)]);
    const result = parseDocument(halves, getPart, ids());
    if (!result.ok) throw new Error(result.error);
    // the third overlaps both by half a stud
    expect(allBricks(result.value.doc.model).map((b) => [b.x, b.z])).toEqual([
      [0.5, -1.5],
      [2.5, -1.5],
    ]);
    expect(result.value.warnings).toEqual(['Skipped 1 brick that overlapped another.']);
    expect(JSON.parse(serializeDocument(result.value.doc)).bricks.map((b: { x: number }) => b.x)).toEqual([0.5, 2.5]);
    // off whole and half studs and plates, a brick may stand on any whole LDraw unit, as parts built on turned ones do
    const lattice = parseDocument(file([record('plate-1x2', 0.25, 0.5, 0.05)]), getPart, ids());
    if (!lattice.ok) throw new Error(lattice.error);
    expect(allBricks(lattice.value.doc.model).map((b) => [b.x, b.y, b.z])).toEqual([[0.25, 0.5, 0.05]]);
    for (const [x, y] of [
      [1 / 3, 0],
      [0, 1 / 3],
    ] as const) {
      expect(parseDocument(file([record('plate-1x2', x, y, 0)]), getPart, ids()).ok).toBe(false);
    }
  });

  it('keeps parts on their sides and upside down, and only the 24 ways a part can face', () => {
    const turned = { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 16 };
    const result = parseDocument(file([turned, { ...turned, r: 6, z: 3 }]), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(allBricks(result.value.doc.model).map((b) => b.r)).toEqual([16, 6]);
    expect(JSON.parse(serializeDocument(result.value.doc)).bricks.map((b: { r: number }) => b.r)).toEqual([16, 6]);
    expect(parseDocument(file([{ ...turned, r: 24 }]), getPart, ids()).ok).toBe(false);
  });

  it('drops bricks that overlap earlier ones', () => {
    const result = parseDocument(file([record('brick-2x4', 0, 0, 0), record('brick-2x4', 1, 1, 0), record('brick-2x4', 0, 3, 0)]), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(allBricks(result.value.doc.model).map((b) => b.y)).toEqual([0, 3]);
    expect(result.value.warnings).toEqual([expect.stringMatching(/1 brick that overlapped/)]);
    expect(result.value.skippedBricks).toBe(1);
  });

  it('counts every brick it leaves out and names the unknown parts', () => {
    const bricks = [record('brick-2x4', 0, 0, 0), record('ldraw:3001', 4, 0, 0), record('brick-2x4', 1, 1, 0), record('plate-16x16', 512, 1023, 512)];
    const result = parseDocument(file(bricks), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.skippedBricks).toBe(3);
    expect(result.value.unknownParts).toEqual(['ldraw:3001']);
  });

  it('keeps a loose part whose box reaches under the ground where its shape does not, and no square part under it', () => {
    const bar: PartDef = { ...getPart('brick-1x1')!, id: 'bar', h: 8, extent: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 3, z: 0.2 } } };
    const withBar: PartLookup = (id) => (id === 'bar' ? bar : getPart(id));
    // a bar lying along X, its middle 0.3 up: its box reaches half a stud down, its shape a fifth
    const lying = { part: 'bar', color: 4, x: -1.5, y: -0.5, z: 0.5, r: 6, m: [0, -1, 0, 1, 0, 0, 0, 0, 1] };
    const kept = parseDocument(file([lying]), withBar, ids());
    expect(kept.ok && kept.value.doc.model.bricks.size).toBe(1);
    // a square brick has no shape of its own to go by
    expect(parseDocument(file([{ part: 'brick-1x1', color: 4, x: 0, y: -1, z: 0, r: 0 }]), withBar, ids()).ok).toBe(false);
  });

  it('drops bricks that stick out past the edge of the grid', () => {
    const result = parseDocument(file([record('plate-16x16', 512, 1023, 512), record('brick-1x1', 0, 0, 0)]), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.doc.model.bricks.size).toBe(1);
    expect(result.value.warnings).toEqual([expect.stringMatching(/outside the building area/)]);
  });

  it('refuses models too big to open', () => {
    const huge = Array.from({ length: 9000 }, (_, i) => record('plate-16x16', -512 + 16 * Math.floor(i / 1000), i % 1000, 0));
    const result = parseDocument(file(huge), getPart, ids());
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/too big/i) });
  });

  it('replaces an unknown baseplate colour with the default', () => {
    const result = parseDocument(file([], { baseplateSize: 16, baseplateColor: 987654321 }), getPart, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.doc.settings).toEqual({ baseplateSize: 16, baseplateColor: DEFAULT_SCENE.baseplateColor });
  });

  it('skips unknown parts and swaps unknown colours, with warnings', () => {
    const text = JSON.stringify({
      format: 'brickbench.model',
      version: 1,
      name: 'x',
      bricks: [
        { part: 'mystery-part', color: 4, x: 0, y: 0, z: 0, r: 0 },
        { part: 'brick-2x4', color: 99999, x: 0, y: 0, z: 0, r: 0 },
      ],
    });
    const result = parseDocument(text, getPart, ids());
    if (!result.ok) throw new Error(result.error);
    const bricks = allBricks(result.value.doc.model);
    expect(bricks).toHaveLength(1);
    expect(bricks[0]?.colorId).toBe(DEFAULT_COLOR_ID);
    expect(result.value.warnings).toHaveLength(2);
    expect(result.value.doc.settings).toEqual(DEFAULT_SCENE);
  });
});
