import { describe, expect, it } from 'bun:test';
import type { LDrawIndexEntry } from '../core/ldraw/format';
import { finderFor } from './partFinder';

const hinge: LDrawIndexEntry = { id: '3937', name: 'Hinge 1 × 2 Base', category: 'Hinge', w: 2, d: 1, h: 2, origin: [0, 0, 0], snug: true };

describe('the shared part finder', () => {
  it('is built once per library index and searches it with the basic parts', () => {
    const entries = [hinge];
    expect(finderFor(entries)).toBe(finderFor(entries));
    expect(finderFor(entries).find('hinge').items.map((i) => i.partId)).toContain('ldraw:3937');
    expect(finderFor([]).find('hinge').items).toEqual([]);
    expect(finderFor([]).count).toBeGreaterThan(80);
  });
});
