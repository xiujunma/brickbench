import { describe, expect, it } from 'bun:test';
import { getColor } from '../../colors';
import { colourInQuery } from './colourWords';

const named = (query: string) => {
  const { colorId, rest } = colourInQuery(query);
  return { colour: colorId === null ? null : (getColor(colorId)?.name ?? '?'), rest };
};

describe('colours in a query', () => {
  it('takes the colour out of what to search for', () => {
    expect(named('red 2x4 brick')).toEqual({ colour: 'Red', rest: '2x4 brick' });
    expect(named('Brick 2 x 4 in Dark Red')).toEqual({ colour: 'Dark Red', rest: 'brick 2x4 in' });
    expect(named('plate light bluish grey')).toEqual({ colour: 'Light Bluish Grey', rest: 'plate' });
    expect(named('trans clear tile')).toEqual({ colour: 'Trans Clear', rest: 'tile' });
  });

  it('knows the everyday names and spellings', () => {
    expect(named('gray plate').colour).toBe('Light Bluish Grey');
    expect(named('dark gray plate').colour).toBe('Dark Bluish Grey');
    expect(named('clear 1x1 round').colour).toBe('Trans Clear');
    expect(named('brown brick').colour).toBe('Reddish Brown');
  });

  it('leaves part words alone', () => {
    // "flat" means a tile unless it is Flat Silver
    expect(named('flat 2x2')).toEqual({ colour: null, rest: 'flat 2x2' });
    expect(named('flat silver 2x2')).toEqual({ colour: 'Flat Silver', rest: '2x2' });
    expect(named('technic reduced axlehole')).toEqual({ colour: null, rest: 'technic reduced axlehole' });
    expect(named('red')).toEqual({ colour: 'Red', rest: '' });
    expect(named('')).toEqual({ colour: null, rest: '' });
  });
});
