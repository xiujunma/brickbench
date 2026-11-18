import { describe, expect, it } from 'bun:test';
import { toPartDef } from '../../ldraw/catalogIndex';
import type { SolidBox } from '../../ldraw/format';
import { PARTS } from '../catalog';
import { describeGrid, describeSubject } from './describe';
import { matchesPattern } from './match';
import { parsePattern } from './parse';
import { subjectOf, type Subject } from './subject';

const SUBJECTS = PARTS.map(subjectOf);

function found(text: string, among: readonly Subject[]): string[] {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message} at ${parsed.error.at}`);
  return among.filter((subject) => matchesPattern(parsed.pattern, subject)).map((subject) => subject.partId);
}

/** A big library part filling every other cell, so its top face is too long to write out. */
function chequered(name: string, category: string): Subject {
  const size = 40;
  const solids: SolidBox[] = [];
  for (let z = 0; z < size; z++) for (let x = z % 2; x < size; x += 2) solids.push([x, 0, z, x + 1, 3, z + 1]);
  return subjectOf(toPartDef({ id: 'big', name, category, w: size, d: size, h: 3, origin: [0, 0, 0], snug: true, solids }));
}

describe('canonical patterns', () => {
  it.each(SUBJECTS.map((subject) => [subject.partId, subject] as const))('%s reads back as itself and nothing else', (partId, subject) => {
    expect(found(describeSubject(subject), SUBJECTS)).toEqual([partId]);
    expect(found(describeSubject(subject, { number: false }), SUBJECTS)).toContain(partId);
  });

  it('leave out a height the kind implies, and the number when asked', () => {
    const [plate, brick, slope] = ['plate-1x2', 'brick-1x2', 'slope45-2x1'].map((id) => SUBJECTS.find((s) => s.partId === id) as Subject);
    expect(describeSubject(plate as Subject)).toBe('P[oo]=3023b');
    expect(describeSubject(brick as Subject, { number: false })).toBe('B[oo]');
    expect(describeSubject(slope as Subject, { number: false })).toBe('S45[o/.]^3');
  });

  it('give way to the size when the top face is too long to read', () => {
    const big = chequered('Baseplate 40 × 40 with Holes', 'Baseplate');
    expect(describeSubject(big)).toBe('*40x40^3=big');
    expect(found(describeSubject(big), [big])).toEqual(['ldraw:big']);
    const slope = chequered('Slope Brick 45 40 × 40', 'Slope');
    expect(describeSubject(slope)).toBe('S45 40x40^3=big');
    expect(found(describeSubject(slope), [slope])).toEqual(['ldraw:big']);
    const inverted = chequered('Slope Brick 45 40 × 40 Inverted', 'Slope');
    expect(describeSubject(inverted)).toBe('S45i40x40^3=big');
    expect(found(describeSubject(inverted), [inverted])).toEqual(['ldraw:big']);
  });
});

describe('describing a grid', () => {
  it('counts rows that are all alike, and runs of five or more alike cells', () => {
    expect(describeGrid('oo/oo')).toBe('[oo]{2}');
    expect(describeGrid('oo')).toBe('[oo]');
    expect(describeGrid('oooo/....')).toBe('[oooo/....]');
    expect(describeGrid('oooooo/o_____')).toBe('[o{6}/o_{5}]');
    expect(describeGrid('##########')).toBe('[#{10}]');
  });
});
