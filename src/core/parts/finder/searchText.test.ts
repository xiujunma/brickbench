import { describe, expect, it } from 'bun:test';
import { readSearchText } from './searchText';

describe('search box text', () => {
  it('takes the colour out of words, to build in', () => {
    expect(readSearchText('red 2x4 brick')).toEqual({ colorId: 4, rest: '2x4 brick', patternError: null });
    expect(readSearchText('plate')).toEqual({ colorId: null, rest: 'plate', patternError: null });
  });

  it('keeps a part pattern as typed, its colour term picking the colour', () => {
    expect(readSearchText(' P2x4 :red ')).toEqual({ colorId: 4, rest: 'P2x4 :red', patternError: null });
    expect(readSearchText('S45[oo/..]')).toEqual({ colorId: null, rest: 'S45[oo/..]', patternError: null });
  });

  it('searches a broken pattern as words, keeping why it did not read', () => {
    expect(readSearchText('red P2x4 [oo')).toEqual({ colorId: 4, rest: 'p2x4 oo', patternError: { message: 'Colours take a colon: :red', at: 0 } });
  });
});
