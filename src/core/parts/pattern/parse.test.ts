import { describe, expect, it } from 'bun:test';
import type { Dim, Height, PartTerm, PatternNode } from './ast';
import { MAX_PATTERN_LENGTH, parsePattern } from './parse';

function root(text: string): PatternNode {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message} at ${parsed.error.at}`);
  return parsed.pattern.root;
}

function term(text: string): PartTerm {
  const node = root(text);
  if (node.type !== 'part') throw new Error(`${text} is a ${node.type}, not a part term`);
  return node.term;
}

function refusal(text: string): { readonly message: string; readonly at: number } {
  const parsed = parsePattern(text);
  if (parsed.ok) throw new Error(`${text} was not refused`);
  return parsed.error;
}

const one = (value: number): Dim => ({ type: 'set', values: [value] });
const plates = (value: number): Height => ({ dim: one(value), unit: 1 });

describe('part terms', () => {
  it('give kinds their heights unless they say otherwise', () => {
    expect(term('B')).toEqual({ kind: 'B', angle: null, inverted: false, footprint: null, face: null, height: plates(3) });
    expect(term('P').height).toEqual(plates(1));
    expect(term('T').height).toEqual(plates(1));
    for (const kind of ['S', 'R', 'C', 'A', '*']) expect(term(kind).height).toBeNull();
    expect(term('B^*').height).toBeNull();
    expect(term('B^6').height).toEqual(plates(6));
    expect(term('P^{1,3}').height).toEqual({ dim: { type: 'range', min: 1, max: 3 }, unit: 1 });
    expect(term('^(1|2)').height).toEqual({ dim: { type: 'set', values: [1, 2] }, unit: 1 });
  });

  it('read sizes either side of x, with choices, ranges and any', () => {
    expect(term('P2x4').footprint).toEqual({ a: one(2), b: one(4) });
    expect(term('P2×4').footprint).toEqual({ a: one(2), b: one(4) });
    expect(term('B1x(1|2|2)').footprint).toEqual({ a: one(1), b: { type: 'set', values: [1, 2] } });
    expect(term('(1|2)x4')).toMatchObject({ kind: null, footprint: { a: { type: 'set', values: [1, 2] }, b: one(4) } });
    expect(term('{1,2}x*').footprint).toEqual({ a: { type: 'range', min: 1, max: 2 }, b: { type: 'any' } });
    expect(term('*x4')).toMatchObject({ kind: null, footprint: { a: { type: 'any' }, b: one(4) } });
    expect(term('*2x4')).toMatchObject({ kind: null, footprint: { a: one(2), b: one(4) } });
  });

  it('take a third size as the height in bricks', () => {
    expect(term('B1x2x5').height).toEqual({ dim: one(5), unit: 3 });
    expect(term('B1x2x*').height).toBeNull();
    expect(refusal('B1x2x5^15')).toEqual({ message: 'Give the height once: a third size in bricks (B1x2x5) or ^ and plates (B1x2^15)', at: 6 });
  });

  it('read a slope’s angle and inversion, leaving digits before an x to the size', () => {
    expect(term('S45')).toMatchObject({ kind: 'S', angle: 45, inverted: false, footprint: null });
    expect(term('S45i')).toMatchObject({ angle: 45, inverted: true });
    expect(term('Si')).toMatchObject({ angle: null, inverted: true });
    expect(term('S2x2')).toMatchObject({ angle: null, footprint: { a: one(2), b: one(2) } });
    expect(term('S45i2x2')).toMatchObject({ angle: 45, inverted: true, footprint: { a: one(2), b: one(2) } });
    expect(root('S45 2x2')).toMatchObject({ type: 'and', nodes: [{ term: { angle: 45 } }, { term: { footprint: { a: one(2) } } }] });
    expect(refusal('S0')).toEqual({ message: 'A slope’s angle is from 1 to 90 degrees', at: 1 });
  });

  it('read top faces, with their rows counted', () => {
    expect(term('T[..]{2}').face?.rows).toEqual({ min: 2, max: 2 });
    expect(term('S45[oo/..]^3')).toMatchObject({ angle: 45, face: { rows: { min: 2, max: 2 } }, height: plates(3) });
    expect(term('[[o_]o]').face?.rows).toEqual({ min: 1, max: 1 });
    expect(refusal('[[[o]]]')).toEqual({ message: 'Cell classes such as [o.] do not nest', at: 2 });
    expect(refusal('[oo]{2')).toEqual({ message: 'A “{” needs its “}”', at: 4 });
    expect(refusal('[o x]').at).toBe(2);
  });

  it('refuse sizes and heights that cannot be', () => {
    expect(refusal('P0x2')).toEqual({ message: 'Sizes and heights start at 1', at: 1 });
    expect(refusal('P2x999')).toEqual({ message: 'Sizes go up to 256 studs and heights to 1023 plates', at: 3 });
    expect(refusal('P2x(1|999)').message).toBe('Sizes go up to 256 studs and heights to 1023 plates');
    expect(refusal('P2x{1,2').message).toBe('A “{” needs its “}”');
    expect(refusal('P2x{3,1}').message).toBe('A count’s maximum cannot be below its minimum');
    expect(refusal('P2x(1|a)')).toEqual({ message: 'A choice of sizes is written with numbers, as in (1|2|4)', at: 3 });
    expect(refusal('P2x')).toEqual({ message: 'A size is a number, *, {min,max} or a choice such as (1|2)', at: 3 });
    expect(refusal('B^')).toEqual({ message: 'A height is ^ and plates: ^3, ^{1,3}, ^(1|2), or ^* for any', at: 2 });
    expect(refusal('^2000').message).toBe('Sizes go up to 256 studs and heights to 1023 plates');
  });
});

describe('other terms', () => {
  it('read features and nicknames, wanted or not', () => {
    expect(root('+clip')).toEqual({ type: 'feature', name: 'clip', wanted: true });
    expect(root('-side-studs')).toEqual({ type: 'feature', name: 'side-studs', wanted: false });
    expect(root('+cheese')).toEqual({ type: 'feature', name: 'cheese', wanted: true });
    expect(refusal('+')).toEqual({ message: 'Name a feature after + or -, as in +clip', at: 0 });
    expect(refusal('+shiny').at).toBe(1);
  });

  it('read colours by name, builder’s name or LDraw code', () => {
    expect(root(':red')).toEqual({ type: 'colour', colour: 4 });
    expect(root(':4')).toEqual({ type: 'colour', colour: 4 });
    expect(root(':dark-bluish-grey')).toEqual({ type: 'colour', colour: 72 });
    expect(root(':Dark_Bluish_Gray')).toEqual({ type: 'colour', colour: 72 });
    expect(root(':grey')).toEqual({ type: 'colour', colour: 71 });
    expect(refusal(':')).toEqual({ message: 'Name a colour after :, as in :red, :dark-bluish-grey or :4', at: 0 });
    expect(refusal(':9999')).toEqual({ message: 'No colour is called “9999”', at: 1 });
    expect(refusal(':red-brick').message).toBe('No colour is called “red-brick”');
  });

  it('read part numbers as globs, in lower case, with or without .dat', () => {
    expect(root('=3040B')).toEqual({ type: 'number', glob: '3040b' });
    expect(root('=30*')).toEqual({ type: 'number', glob: '30*' });
    expect(root('=3001.dat')).toEqual({ type: 'number', glob: '3001' });
    expect(refusal('=')).toEqual({ message: 'Write a part number after =, as in =3001 or =30*', at: 0 });
  });

  it('read sources and quoted words', () => {
    expect(root('@library')).toEqual({ type: 'source', source: 'library' });
    expect(root('@owned')).toEqual({ type: 'source', source: 'owned' });
    expect(root('"With  Clip"')).toEqual({ type: 'name', words: ['with', 'clip'] });
    expect(root('“1 × 2”')).toEqual({ type: 'name', words: ['1x2'] });
    expect(refusal('"clip')).toEqual({ message: 'A quote needs its closing quote', at: 0 });
    expect(refusal('" "')).toEqual({ message: 'Put words between the quotes, as in "clip"', at: 0 });
  });

  it('say what a stray word or sign was probably meant to be', () => {
    expect(refusal('P2x4 clip').message).toBe('Features take + or -: +clip');
    expect(refusal('red P2x4').message).toBe('Colours take a colon: :red');
    expect(refusal('Bi').message).toBe('Only slopes are inverted: write i straight after S or its angle, as in S45i');
    expect(refusal('B2x4i').message).toBe('Only slopes are inverted: write i straight after S or its angle, as in S45i');
    expect(refusal('Q2x4').message).toBe('The kinds are B, P, T, S, R, C and A: “Q” is not one');
    expect(refusal('b').message).toBe('Kinds are capital letters: B');
    expect(refusal('P]').message).toBe('This “]” closes nothing');
    expect(refusal('P }').message).toBe('This “}” closes nothing');
    expect(refusal('P %')).toEqual({ message: '“%” has no meaning here', at: 2 });
  });
});

describe('patterns', () => {
  it('put terms side by side for all, | for either, ! for not, and ( ) to group', () => {
    expect(root('P | T :red')).toEqual({
      type: 'or',
      nodes: [root('P'), { type: 'and', nodes: [root(':red'), root('T')] }],
    });
    expect(root('!+clip')).toEqual({ type: 'not', node: root('+clip') });
    expect(root('! !P')).toEqual({ type: 'not', node: { type: 'not', node: root('P') } });
    expect(root('(P | T) 2x4')).toEqual({ type: 'and', nodes: [root('P | T'), root('2x4')] });
    expect(root('  P2x4  ')).toEqual(root('P2x4'));
  });

  it('test cheap terms before top faces, keeping the order otherwise', () => {
    const node = root('[oo] =3* P +clip !(T[o]) ("a"|B)');
    expect(node.type === 'and' && node.nodes.map((n) => n.type)).toEqual(['number', 'feature', 'part', 'or', 'part', 'not']);
  });

  it('let terms touch where one clearly ends', () => {
    expect(root('S45[oo/..]^3=3039')).toMatchObject({ type: 'and', nodes: [{ type: 'number' }, { type: 'part' }] });
    expect(root('P1x2+clip:red@basic')).toMatchObject({ type: 'and', nodes: [{ type: 'feature' }, { type: 'colour' }, { type: 'source' }, { type: 'part' }] });
  });

  it('refuse patterns that do not hold together', () => {
    expect(refusal('')).toEqual({ message: 'Write a pattern, such as P2x4 or S45[oo/..]', at: 0 });
    expect(refusal('   ').at).toBe(3);
    expect(refusal('P |')).toEqual({ message: 'Nothing to match here: each side of “|”, and each ( ), needs a term', at: 3 });
    expect(refusal('()').at).toBe(1);
    expect(refusal('(P')).toEqual({ message: 'A “(” needs its “)”', at: 0 });
    expect(refusal('P)')).toEqual({ message: 'This “)” has no “(” to close', at: 1 });
    expect(refusal('P !')).toEqual({ message: 'A “!” needs a term after it', at: 3 });
    expect(refusal('@mine')).toEqual({ message: 'A source is @basic, @library or @owned', at: 0 });
  });

  it('refuse patterns too long or too deep to be worth reading', () => {
    expect(refusal(`P${' '.repeat(MAX_PATTERN_LENGTH)}`)).toEqual({ message: `A pattern has at most ${MAX_PATTERN_LENGTH} characters`, at: MAX_PATTERN_LENGTH });
    expect(refusal(`${'('.repeat(40)}P${')'.repeat(40)}`).message).toBe('Patterns nest at most 32 deep');
    expect(refusal(`${'!'.repeat(40)}P`).message).toBe('Patterns nest at most 32 deep');
    expect(parsePattern(`${'('.repeat(30)}P${')'.repeat(30)}`).ok).toBe(true);
  });

  it('keep the text as written', () => {
    const parsed = parsePattern(' P2x4 ');
    expect(parsed.ok && parsed.pattern.text).toBe(' P2x4 ');
  });
});
