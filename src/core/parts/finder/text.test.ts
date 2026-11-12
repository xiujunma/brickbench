import { describe, expect, it } from 'bun:test';
import { allowedTypos, withinEdits } from './fuzzy';
import { parseQuery } from './query';
import { featuresOf, footprintKey, heightClassOf, nicknamesOf } from './tags';
import { containsWord, findWord, normalizeForSearch, startsWord } from './text';

describe('normalizeForSearch', () => {
  it('writes sizes one way however they are typed', () => {
    for (const typed of ['Brick 2 × 4', 'brick 2 x 4', 'brick 2x4', 'Brick 2 by 4', 'brick two by four', 'BRICK TWO X FOUR']) {
      expect(normalizeForSearch(typed), typed).toBe('brick 2x4');
    }
    expect(normalizeForSearch('Slope 45° 1 × 1 × 0.667')).toBe('slope 45 1x1x0.667');
  });

  it('spells number words as digits and drops punctuation', () => {
    expect(normalizeForSearch('Hinge, Locking with Two Fingers (7 Teeth)')).toBe('hinge locking with 2 fingers 7 teeth');
    expect(normalizeForSearch('  lots   of  space ')).toBe('lots of space');
    // number words only as whole words
    expect(normalizeForSearch('Tentacle')).toBe('tentacle');
  });
});

describe('containsWord', () => {
  it('matches sizes as whole numbers and other words anywhere', () => {
    expect(containsWord('brick 1x2x3', '1x2')).toBe(true);
    expect(containsWord('panel 11x23', '1x2')).toBe(false);
    expect(containsWord('plate 1x20', '1x2')).toBe(false);
    expect(containsWord('slope 0.5x1', '5x1')).toBe(false);
    expect(containsWord('plate 1x2', 'plat')).toBe(true);
    expect(containsWord('technic 32000', '3200')).toBe(true);
  });

  it('does not find a size inside a longer one', () => {
    expect(containsWord('brick 1x2x2', '2x2')).toBe(false);
    expect(containsWord('brick 2x2x3', '2x2')).toBe(true);
    expect(findWord('slope 45 2x4', '2x4')).toBe(9);
    expect(findWord('brick 1x2x2', '2x2')).toBe(-1);
    // a fraction carries the size on: 1 × 2 × 2/3 is not 1 × 2 × 2
    expect(containsWord('slope 30 1x2x2/3', '1x2x2')).toBe(false);
    expect(containsWord('slope 30 1x2x2/3', '1x2')).toBe(true);
    expect(containsWord('tyre 6/50x8', '50x8')).toBe(false);
    // nor does a mixed number: 2 × 4 × 1⅔ is not 2 × 4 × 1
    expect(containsWord('windscreen 2x4x1 & 2/3', '2x4x1')).toBe(false);
    expect(containsWord('brick 1x2x1 2/3 with studs on 1 side', '1x2x1')).toBe(false);
    expect(containsWord('brick 1x2x1 with', '1x2x1')).toBe(true);
    expect(containsWord('brick 1x2x1 2/3 with studs on 1 side', '1x2')).toBe(true);
  });

  it('can insist on the start of a word', () => {
    expect(containsWord('turntable spindle', 'pin')).toBe(true);
    expect(containsWord('turntable spindle', 'pin', true)).toBe(false);
    expect(findWord('spindle with pin', 'pin', true)).toBe(13);
    expect(startsWord('technic pin', 8)).toBe(true);
    expect(startsWord('technic pin', 0)).toBe(true);
    expect(startsWord('spindle', 2)).toBe(false);
  });
});

describe('parseQuery', () => {
  const spellings = (query: string): string[] => parseQuery(query).terms[0]?.options.map((o) => o.words.join(' ')) ?? [];

  it('accepts plurals, synonyms and US spellings', () => {
    const [bricks, tires, liftarm] = parseQuery('bricks tires liftarm').terms;
    expect(bricks?.options).toContainEqual({ words: ['brick'], wordStart: false });
    expect(tires?.options).toContainEqual({ words: ['tyre'], wordStart: true });
    expect(liftarm?.options).toContainEqual({ words: ['technic', 'beam'], wordStart: true });
    expect(spellings('boxes')).toContain('box');
    expect(spellings('glass')).toEqual(['glass']);
  });

  it('drops "es" only where English adds it', () => {
    expect(spellings('hinges')).toEqual(['hinges', 'hinge']);
    expect(spellings('glasses')).toContain('glass');
    expect(spellings('benches')).toContain('bench');
    expect(spellings('hoses')).toEqual(['hoses', 'hose']);
    expect(spellings('batteries')).toContain('battery');
    expect(spellings('bus')).toEqual(['bus']);
  });

  it('reads sizes either way round, as the size filter does', () => {
    expect(spellings('4x2')).toEqual(['4x2', '2x4']);
    expect(spellings('4x2x3')).toEqual(['4x2x3', '2x4x3']);
    expect(spellings('2x2')).toEqual(['2x2']);
  });

  it('leaves out words that never name a part', () => {
    expect(parseQuery('lego brick').terms.map((t) => t.text)).toEqual(['brick']);
    expect(parseQuery('Lego bricks 2x4').phrase).toBe('bricks 2x4');
  });

  it('treats every word as plain text', () => {
    expect(() => parseQuery('constructor __proto__ toString hasOwnProperty')).not.toThrow();
    expect(spellings('constructor')).toEqual(['constructor']);
  });

  it('forgives typos only in longer plain words', () => {
    const terms = parseQuery('plate 2x4 bar 45').terms;
    expect(terms.map((t) => t.forgiving)).toEqual([true, false, false, false]);
    expect(parseQuery('Two by Four Brick').phrase).toBe('2x4 brick');
  });
});

describe('nicknames and features', () => {
  it('knows what builders call parts', () => {
    expect(nicknamesOf('slope brick 31 1x1x0.667 double concave')).toContain('cheese');
    expect(nicknamesOf('plate 1x2 with groove with 1 centre stud')).toEqual(['jumper']);
    expect(nicknamesOf('plate 1x2 with 1 center stud')).toEqual(['jumper']);
    expect(nicknamesOf('plate 2x2 round with 1 centre stud')).toEqual([]);
    expect(nicknamesOf('brick 1x2 without centre stud')).toEqual([]);
    expect(nicknamesOf('brick 2x2 corner round with stud notch')).toEqual(['macaroni']);
    expect(nicknamesOf('brick 1x1 with headlight')).toEqual(['snot', 'erling']);
    expect(nicknamesOf('plate 1x1 round')).toEqual(['dot']);
    expect(nicknamesOf('plate 1x1 round with bar')).toEqual([]);
    expect(nicknamesOf('technic beam 3')).toEqual(['liftarm']);
  });

  it('reads features from names', () => {
    expect([...featuresOf('plate 1x1 with clip horizontal thick c-clip')]).toEqual(['clip']);
    expect(featuresOf('brick 1x1 with studs on 4 sides').has('side-studs')).toBe(true);
    expect(featuresOf('technic brick 1x2 with holes').has('holes')).toBe(true);
    expect(featuresOf('slope 45 2x1').has('slope')).toBe(true);
    expect(featuresOf('tile 1x2 grille with groove').has('smooth')).toBe(true);
    expect(featuresOf('hinge 1x2 base').has('hinge')).toBe(true);
    expect(featuresOf('wheel 11mm d. x 6mm with centre groove').has('wheel')).toBe(true);
    expect(featuresOf('door 1x3x4 left')).toContain('window-door');
    expect(featuresOf('plate 2x2 round').has('round')).toBe(true);
  });

  it('reads the other ways LDraw names say the same features', () => {
    expect(featuresOf('technic brick 1x2 with peghole').has('holes')).toBe(true);
    expect(featuresOf('technic beam 3 with 2 pegholes').has('holes')).toBe(true);
    expect(featuresOf('brick 1x2x1 2/3 with side studs').has('side-studs')).toBe(true);
    expect(nicknamesOf('brick 1x2x1 2/3 with side studs')).toContain('snot');
    expect(featuresOf('plate 1x2 hinged').has('hinge')).toBe(true);
    expect(featuresOf('hinge plate 1x4 with 2 hinges').has('hinge')).toBe(true);
    expect(featuresOf('brick 1x2 sloped').has('slope')).toBe(true);
    expect(featuresOf('windscreen 2x4x2').has('window-door')).toBe(true);
  });

  it('sorts heights into classes and footprints either way round', () => {
    expect([1, 2, 3, 5, 9].map(heightClassOf)).toEqual(['plate', 'two-plates', 'brick', 'up-to-two-bricks', 'taller']);
    expect(heightClassOf(0)).toBeNull();
    expect(footprintKey(4, 2)).toBe(footprintKey(2, 4));
    expect(footprintKey(4, 2)).toBe('2x4');
  });
});

describe('typo tolerance', () => {
  it('allows one slip in short words and two in long ones', () => {
    expect([3, 4, 7, 8].map(allowedTypos)).toEqual([0, 1, 1, 2]);
    expect(withinEdits('brcik', 'brick', 1)).toBe(true);
    expect(withinEdits('plaet', 'plate', 1)).toBe(true);
    expect(withinEdits('hinje', 'hinge', 1)).toBe(true);
    expect(withinEdits('windscren', 'windscreen', 2)).toBe(true);
    expect(withinEdits('brick', 'block', 1)).toBe(false);
    expect(withinEdits('tile', 'technic', 2)).toBe(false);
    expect(withinEdits('same', 'same', 0)).toBe(true);
  });
});
