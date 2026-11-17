import { describe, expect, it } from 'bun:test';
import type { PartNumbers } from '../../inventory/match';
import { partIdFor } from '../../inventory/stock';
import { createPartResolver, isModelFile, isPrimitive, numberOfFile } from './match';

const NUMBERS: PartNumbers = {
  known: new Set(['3001', '3626b', '6141', '98138', '10202']),
  noted: { bricklink: new Map([['bl6141', '6141']]), rebrickable: new Map([['rb3001', '3001']]) },
  aliases: new Map([['4073', '6141']]),
};

const resolver = createPartResolver(NUMBERS);

describe('numberOfFile', () => {
  it('reads the part number from any spelling of the file name', () => {
    expect(numberOfFile('3001.dat')).toBe('3001');
    expect(numberOfFile(' Parts\\3001.DAT')).toBe('3001');
    expect(numberOfFile('3001')).toBe('3001');
  });
});

describe('isModelFile', () => {
  it('tells model files from parts', () => {
    expect(isModelFile('wheels.LDR')).toBe(true);
    expect(isModelFile('sub.mpd')).toBe(true);
    expect(isModelFile('3001.dat')).toBe(false);
    expect(isModelFile('motor bogie')).toBe(false);
  });
});

describe('isPrimitive', () => {
  it('knows the drawing shapes models use for strings and details', () => {
    for (const file of ['4-4cyli.dat', '48\\4-4cyli.dat', 'p/8/1-4edge.dat', 'box5-12.dat', 'rect3.dat', 'stud2s2e.dat', 'STUD.DAT']) expect(isPrimitive(file)).toBe(true);
  });

  it('does not take parts for shapes', () => {
    for (const file of ['3001.dat', '3626bp01.dat', '2536.dat', 'u9241.dat', '4-4.ldr']) expect(isPrimitive(file)).toBe(false);
  });
});

describe('createPartResolver', () => {
  it('knows parts by their own number, and by the number LDraw renamed', () => {
    expect(resolver.exact('3001.DAT')).toEqual({ partId: partIdFor('3001'), number: '3001', plain: false });
    expect(resolver.exact('4073.dat')).toEqual({ partId: partIdFor('6141'), number: '6141', plain: false });
  });

  it('builds printed and stickered parts as their plain part', () => {
    expect(resolver.exact('3626bp01.dat')).toBeNull();
    expect(resolver.resolve('3626bp01.dat')).toEqual({ partId: partIdFor('3626b'), number: '3626b', plain: true });
    expect(resolver.resolve('98138p2l.dat')).toMatchObject({ number: '98138', plain: true });
    expect(resolver.resolve('10202d01.dat')).toMatchObject({ number: '10202', plain: true });
    expect(resolver.resolve('4073p01.dat')).toMatchObject({ number: '6141', plain: true });
  });

  it('follows the catalogue numbers LDraw notes, for Studio parts named the BrickLink way', () => {
    expect(resolver.resolve('bl6141.dat')).toEqual({ partId: partIdFor('6141'), number: '6141', plain: false });
    expect(resolver.resolve('rb3001.dat')).toMatchObject({ number: '3001', plain: false });
  });

  it('knows nothing of parts BrickBench lacks, or of model files', () => {
    expect(resolver.resolve('71427c01.dat')).toBeNull();
    expect(resolver.resolve('p01.dat')).toBeNull();
    expect(resolver.resolve('3001.ldr')).toBeNull();
    expect(resolver.exact('3001.ldr')).toBeNull();
  });
});
