import { describe, expect, it } from 'bun:test';
import { OPEN_ACCEPT, isOpenableName, openableKind } from './openable';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const NONE = new Uint8Array();

describe('openableKind', () => {
  it('goes by the file name first', () => {
    expect(openableKind('house.brickbench.json', NONE)).toBe('brickbench');
    expect(openableKind('Car.LDR', NONE)).toBe('ldraw');
    expect(openableKind('10030-1.mpd', NONE)).toBe('ldraw');
    expect(openableKind('model.l3b', NONE)).toBe('ldraw');
    expect(openableKind('model.dat', NONE)).toBe('ldraw');
    expect(openableKind('whale.io', bytes('{'))).toBe('studio');
  });

  it('looks inside files whose name does not say', () => {
    expect(openableKind('download', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('studio');
    expect(openableKind('download', bytes('﻿0 FILE whale.io\r\n'))).toBe('ldraw');
    expect(openableKind('download', bytes('1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat'))).toBe('ldraw');
    expect(openableKind('download', bytes('{"format":"brickbench.model"}'))).toBe('brickbench');
    expect(openableKind('download', NONE)).toBe('brickbench');
  });
});

describe('isOpenableName', () => {
  it('knows the files Open reads by their ending', () => {
    expect(isOpenableName('house.brickbench.json')).toBe(true);
    expect(isOpenableName('WHALE.IO')).toBe(true);
    expect(isOpenableName('car.ldr')).toBe(true);
    expect(isOpenableName('notes.txt')).toBe(false);
    expect(isOpenableName('--inspect')).toBe(false);
  });
});

describe('OPEN_ACCEPT', () => {
  it('lets the picker offer every kind', () => {
    for (const extension of ['.brickbench.json', '.ldr', '.mpd', '.io']) expect(OPEN_ACCEPT.split(',')).toContain(extension);
  });
});
