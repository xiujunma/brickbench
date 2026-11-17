import { describe, expect, it } from 'bun:test';
import { colourFor, readColourTable } from './colours.ts';

/** Lines as LDConfig.ldr writes them. */
const CONFIG = [
  '0 LDraw.org Configuration File',
  '0 !COLOUR Black                                                 CODE   0   VALUE #1B2A34   EDGE #808080',
  '0 !COLOUR Trans_Clear                                           CODE  47   VALUE #FCFCFC   EDGE #C3C3C3   ALPHA 128',
  '0 !COLOUR Chrome_Gold                                           CODE 334   VALUE #DFC176   EDGE #C2982E                               CHROME',
  '0 !COLOUR Pearl_Light_Grey                                      CODE 135   VALUE #A0A0A0   EDGE #333333                               PEARLESCENT',
  '0 !COLOUR Electric_Contact_Alloy                                CODE 494   VALUE #D0D0D0   EDGE #333333                               METAL',
  '0 !COLOUR Rubber_Black                                          CODE 256   VALUE #1B2A34   EDGE #808080                               RUBBER',
  '0 !COLOUR Glitter_Trans_Clear                                   CODE 117   VALUE #FFFFFF   EDGE #C3C3C3   ALPHA 128                   MATERIAL GLITTER VALUE #FFFFFF FRACTION 0.08 VFRACTION 0.1 SIZE 1',
  '0 !COLOUR Milky_White                                           CODE  79   VALUE #EEEEEE   EDGE #BABABA   ALPHA 240',
  '0 // a comment',
].join('\r\n');

describe('the LDraw colour table', () => {
  const table = readColourTable(CONFIG);

  it('reads each code with its colour and finish', () => {
    expect(table.get(0)).toEqual({ hex: '#1b2a34', finish: 'solid' });
    expect(table.get(47)).toEqual({ hex: '#fcfcfc', finish: 'transparent' });
    expect(table.get(334)).toEqual({ hex: '#dfc176', finish: 'chrome' });
    expect(table.get(135)).toEqual({ hex: '#a0a0a0', finish: 'pearl' });
    expect(table.get(256)).toEqual({ hex: '#1b2a34', finish: 'solid' });
    expect(table.get(117)?.finish).toBe('transparent');
    expect(table.size).toBe(8);
  });

  it('draws nearly opaque colours solid, not as glass', () => {
    expect(table.get(79)).toEqual({ hex: '#eeeeee', finish: 'solid' });
  });

  it('draws metals with the pearl finish, the closest the app has', () => {
    expect(table.get(494)).toEqual({ hex: '#d0d0d0', finish: 'pearl' });
  });

  it('reads direct colours from their codes and greys out unknown ones', () => {
    expect(colourFor(table, 47)).toEqual({ hex: '#fcfcfc', finish: 'transparent' });
    expect(colourFor(table, 0x2ff8000)).toEqual({ hex: '#ff8000', finish: 'solid' });
    expect(colourFor(table, 0x30080ff)).toEqual({ hex: '#0080ff', finish: 'transparent' });
    expect(colourFor(table, 9999)).toEqual({ hex: '#808080', finish: 'solid' });
  });
});
