import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import type { PartDef } from '../parts/types';
import { modelFromBricks } from '../model/model';
import { makeBrick } from '../model/testUtils';
import { toLDraw } from './ldraw';

function brickLines(text: string): string[] {
  return text.split('\r\n').filter((line) => line.startsWith('1 '));
}

describe('LDraw export', () => {
  it('writes a header naming the model', () => {
    const { text } = toLDraw('My Ship', modelFromBricks([]), getPart);
    expect(text.split('\r\n').slice(0, 2)).toEqual(['0 My Ship', '0 Name: my-ship.ldr']);
  });

  it('puts a brick origin at the centre of its top face', () => {
    const { text } = toLDraw('m', modelFromBricks([makeBrick()]), getPart);
    expect(brickLines(text)).toEqual(['1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat']);
  });

  it('turns quarter rotations into LDraw matrices', () => {
    const { text } = toLDraw('m', modelFromBricks([makeBrick({ r: 1 })]), getPart);
    expect(brickLines(text)).toEqual(['1 4 20 -24 -40 0 0 -1 0 1 0 1 0 0 3001.dat']);
  });

  it('offsets slope origins to the stud row', () => {
    const { text } = toLDraw('m', modelFromBricks([makeBrick({ partId: 'slope45-2x2' })]), getPart);
    // footprint centre is (1, 1); the stud row centre is half a stud towards -Z
    expect(brickLines(text)).toEqual(['1 4 20 -24 -10 1 0 0 0 1 0 0 0 1 3039.dat']);
  });

  it('skips parts that have no LDraw equivalent and counts them', () => {
    const custom = (id: string): PartDef | undefined => {
      const base = getPart('brick-1x1');
      if (!base) return undefined;
      return id === 'custom' ? { ...base, id: 'custom', ldraw: undefined } : getPart(id);
    };
    const model = modelFromBricks([makeBrick({ id: 'a', partId: 'custom' }), makeBrick({ id: 'b' })]);
    const result = toLDraw('m', model, custom);
    expect(result.skipped).toBe(1);
    expect(brickLines(result.text)).toHaveLength(1);
  });
});
