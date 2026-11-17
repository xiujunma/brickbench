import { describe, expect, it } from 'bun:test';
import { getColor } from '../../colors';
import { LDRAW_COLOURS } from './colourTable';
import { UNCOLOURED, inheritsColour, nearestColour, readColour, toPalette } from './colours';

describe('readColour', () => {
  it('reads colour codes', () => {
    expect(readColour('4')).toEqual({ code: 4 });
    expect(readColour('0')).toEqual({ code: 0 });
  });

  it('reads direct colours, opaque and transparent', () => {
    expect(readColour('0x2FF8000')).toEqual({ rgb: '#FF8000', transparent: false });
    expect(readColour('0x3336699')).toEqual({ rgb: '#336699', transparent: true });
    expect(readColour('#2abcdef')).toEqual({ rgb: '#ABCDEF', transparent: false });
  });

  it('refuses anything else', () => {
    for (const token of ['-1', 'red', '0x4123456', '0x2FFF', '1.5', '']) expect(readColour(token)).toBeNull();
  });
});

describe('toPalette', () => {
  it('keeps palette colours as they are', () => {
    expect(toPalette({ code: 4 })).toEqual({ colorId: 4, exact: true, name: 'Red' });
    expect(toPalette({ code: 47 })).toEqual({ colorId: 47, exact: true, name: 'Trans Clear' });
  });

  it('brings the old greys in as the bluish greys LEGO replaced them with', () => {
    expect(toPalette({ code: 7 })).toEqual({ colorId: 71, exact: false, name: 'Light Grey' });
    expect(toPalette({ code: 8 })).toEqual({ colorId: 72, exact: false, name: 'Dark Grey' });
  });

  it('keeps the finish: rubber stays solid, pearl stays metallic', () => {
    expect(toPalette({ code: 256 }).colorId).toBe(0);
    expect(getColor(toPalette({ code: 135 }).colorId)?.finish).toMatch(/pearl|chrome/);
  });

  it('gives every colour LDraw knows a palette colour of the same finish', () => {
    for (const [code, , , kind] of LDRAW_COLOURS) {
      const finish = getColor(toPalette({ code }).colorId)?.finish;
      if (kind === 'transparent') expect(finish).toBe('transparent');
      else if (kind === 'metallic') expect(finish).toMatch(/pearl|chrome/);
      else expect(finish).toBe('solid');
    }
  });

  it('brings direct colours in as the nearest', () => {
    expect(toPalette({ rgb: '#B40102', transparent: false })).toEqual({ colorId: 4, exact: false, name: '#B40102' });
    expect(getColor(toPalette({ rgb: '#C91A0A', transparent: true }).colorId)?.name).toBe('Trans Red');
  });

  it('greys out parts the model leaves uncoloured or gives unknown codes', () => {
    expect(toPalette({ code: 16 })).toEqual({ colorId: UNCOLOURED, exact: false, name: 'No colour' });
    expect(toPalette({ code: 24 }).colorId).toBe(UNCOLOURED);
    expect(toPalette({ code: 987654 })).toEqual({ colorId: UNCOLOURED, exact: false, name: 'Colour 987654' });
  });
});

describe('inheritsColour', () => {
  it('is true for the main and edge colour codes only', () => {
    expect(inheritsColour({ code: 16 })).toBe(true);
    expect(inheritsColour({ code: 24 })).toBe(true);
    expect(inheritsColour({ code: 4 })).toBe(false);
    expect(inheritsColour({ rgb: '#000000', transparent: false })).toBe(false);
  });
});

describe('nearestColour', () => {
  it('answers the same twice', () => {
    expect(nearestColour('#123456', 'solid')).toBe(nearestColour('#123456', 'solid'));
  });
});
