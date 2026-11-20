import { describe, expect, it } from 'bun:test';
import { fileKey, readLDraw, type M3 } from './read';

const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('readLDraw', () => {
  it('reads a single-file model: its title and the parts it places', () => {
    const doc = readLDraw(
      ['0 Little Car', '0 Name: car.ldr', '0 Author: Someone', '', '1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat', '0 STEP', '1 0x2FF8000 0 -48 0 0 0 -1 0 1 0 1 0 0 3003.DAT'].join('\n'),
      'car.ldr',
    );
    expect(doc.main.name).toBe('car.ldr');
    expect(doc.main.title).toBe('Little Car');
    expect(doc.main.lines).toEqual([
      { colour: { code: 4 }, position: [40, -24, -20], matrix: IDENTITY, file: '3001.dat', step: 0 },
      { colour: { rgb: '#FF8000', transparent: false }, position: [0, -48, 0], matrix: [0, 0, -1, 0, 1, 0, 1, 0, 0], file: '3003.DAT', step: 1 },
    ]);
    expect(doc.badLines).toBe(0);
    expect(doc.files.get('car.ldr')).toBe(doc.main);
  });

  it('counts the building steps of each file on its own, ROTSTEP ending one as STEP does', () => {
    const doc = readLDraw(
      [
        '0 FILE main.ldr',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
        '0 STEP',
        '0 step',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 roof.ldr',
        '0 ROTSTEP 30 45 0 ABS',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat',
        // a remark that only starts like one is no step
        '0 STEPS to follow',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat',
        '0 STEP',
        '0 FILE roof.ldr',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3039.dat',
        '0 STEP',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3040.dat',
      ].join('\n'),
      'house.mpd',
    );
    expect(doc.main.lines.map((line) => [line.file, line.step])).toEqual([
      ['3001.dat', 0],
      ['roof.ldr', 2],
      ['3003.dat', 3],
      ['3004.dat', 3],
    ]);
    expect(doc.files.get('roof.ldr')?.lines.map((line) => line.step)).toEqual([0, 1]);
  });

  it('keeps spaces in the names of submodels', () => {
    const doc = readLDraw('1 16 0 0 0 1 0 0 0 1 0 0 0 1 Motor Bogie Copy  ', 'm.ldr');
    expect(doc.main.lines[0]?.file).toBe('Motor Bogie Copy');
  });

  it('splits a multi-part file into its files, the first being the model', () => {
    const doc = readLDraw(
      [
        '0 FILE Train.ldr',
        '0 Untitled Model',
        '1 16 0 0 0 1 0 0 0 1 0 0 0 1 bogie',
        '0 NOFILE',
        '0 FILE Bogie',
        '0 Bogie',
        '1 72 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
        '0 NOFILE',
        '0 stray line between files',
        '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
        '0 !DATA sticker.png',
        '0 !: iVBORw0KGgo=',
      ].join('\r\n'),
      'train.mpd',
    );
    expect(doc.main.name).toBe('Train.ldr');
    expect(doc.main.title).toBe('Untitled Model');
    expect([...doc.files.keys()]).toEqual(['train.ldr', 'bogie']);
    expect(doc.files.get('bogie')?.lines).toHaveLength(1);
  });

  it('lets the first of two files with one name win', () => {
    const doc = readLDraw(['0 FILE a.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr', '0 FILE sub.ldr', '1 1 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '0 FILE SUB.LDR', '1 2 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n'), 'x.mpd');
    expect(doc.files.get('sub.ldr')?.lines[0]?.colour).toEqual({ code: 1 });
  });

  it('skips a byte order mark and old Mac line endings', () => {
    const doc = readLDraw('﻿0 FILE whale.io\r0 Whale\r1 272 0 -8 -20 1 0 0 0 1 0 0 0 1 3034.dat\r', 'whale.io');
    expect(doc.main.title).toBe('Whale');
    expect(doc.main.lines).toHaveLength(1);
  });

  it('counts lines it cannot read and leaves them out', () => {
    const doc = readLDraw(['1 4 0 0 0 1 0 0 0 1 0 0 1 3001.dat', '1 4 0 0 x 1 0 0 0 1 0 0 0 1 3001.dat', '1 red 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n'), 'm.ldr');
    expect(doc.badLines).toBe(3);
    expect(doc.main.lines).toHaveLength(1);
  });

  it('marks files that draw shapes as parts of their own', () => {
    const doc = readLDraw(['0 FILE m.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 custom.dat', '0 FILE custom.dat', '0 Custom part', '3 16 0 0 0 1 0 0 0 0 1'].join('\n'), 'm.mpd');
    expect(doc.files.get('custom.dat')?.drawsShapes).toBe(true);
    expect(doc.main.drawsShapes).toBe(false);
  });

  it('takes no title from a file that starts with a meta command', () => {
    expect(readLDraw('0 Name: car.ldr\n0 Car', 'car.ldr').main.title).toBe('');
    expect(readLDraw('0 !LDRAW_ORG Unofficial_Model', 'car.ldr').main.title).toBe('');
  });

  it('reads an empty text as an empty model', () => {
    const doc = readLDraw('', 'empty.ldr');
    expect(doc.main).toEqual({ name: 'empty.ldr', title: '', lines: [], drawsShapes: false, declared: null });
  });

  it('takes no comments before the first FILE line for the model', () => {
    const doc = readLDraw(['0 My model', '0 // exported by hand', '', '0 FILE main.ldr', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n'), 'm.mpd');
    expect(doc.main.name).toBe('main.ldr');
    expect(doc.main.lines).toHaveLength(1);
    expect([...doc.files.keys()]).toEqual(['main.ldr']);
  });

  it('notes what each file declares itself to be', () => {
    const doc = readLDraw(
      ['0 FILE m.ldr', '0 !LDRAW_ORG Unofficial_Model', '0 FILE u1.dat', '0 !LDRAW_ORG Unofficial_Part UPDATE 2024-01', '0 FILE s/u1s01.dat', '0 !LDRAW_ORG Subpart', '0 FILE p.dat', '0 !LDRAW_ORG 48_Primitive', '0 FILE c.dat'].join('\n'),
      'm.mpd',
    );
    expect([...doc.files.values()].map((f) => f.declared)).toEqual(['model', 'part', 'part', 'part', null]);
  });
});

describe('fileKey', () => {
  it('ignores case, surrounding space and the slash used', () => {
    expect(fileKey(' Parts\\3001.DAT ')).toBe('parts/3001.dat');
  });
});
