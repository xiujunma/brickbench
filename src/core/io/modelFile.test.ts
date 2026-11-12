import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { DEFAULT_COLOR_ID } from '../colors';
import { allBricks, modelFromBricks } from '../model/model';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
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
