import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT } from '../core/grid';
import { modelFromBricks } from '../core/model/model';
import { connectorLookup } from '../core/model/connectorTestParts';
import { makeBrick } from '../core/model/testUtils';
import { getPart } from '../core/parts/catalog';
import { orientationFacing } from '../core/orientation';
import { bricksFit, bricksOf, buildTurn, distinctPieces, selectedBricks, spatialIndexFor, worldBounds } from './selectors';
import { createHistory } from '../core/history';

const model = modelFromBricks([
  makeBrick({ id: 'a' }),
  makeBrick({ id: 'b', x: 4, colorId: 1 }),
  makeBrick({ id: 'c', x: 8, y: 3 }),
]);

describe('selectors', () => {
  it('builds the spatial index and brick list once per model', () => {
    expect(spatialIndexFor(model, getPart)).toBe(spatialIndexFor(model, getPart));
    expect(bricksOf(model)).toBe(bricksOf(model));
    expect(spatialIndexFor(model, getPart).owner(5, 0, 0)).toBe('b');
  });

  it('keeps caches for the latest models only, so undo snapshots do not pin indexes', () => {
    const models = [0, 1, 2].map((i) => modelFromBricks([makeBrick({ id: `m${i}`, x: i * 4 })]));
    const [first, second, third] = models as [typeof model, typeof model, typeof model];
    const original = spatialIndexFor(first, getPart);
    spatialIndexFor(second, getPart);
    spatialIndexFor(third, getPart);
    expect(spatialIndexFor(first, getPart)).not.toBe(original);
    expect(spatialIndexFor(first, getPart).owner(0, 0, 0)).toBe('m0');
  });

  it('counts distinct part and colour combinations', () => {
    expect(distinctPieces(model)).toBe(2);
    expect(distinctPieces(modelFromBricks([]))).toBe(0);
  });

  it('returns the selected bricks that still exist', () => {
    const state = { history: createHistory(model), selection: new Set(['c', 'gone']) };
    expect(selectedBricks(state).map((b) => b.id)).toEqual(['c']);
  });

  it('checks whether bricks fit', () => {
    expect(bricksFit(model, [makeBrick({ id: 'n', x: 2 })], getPart)).toBe(false);
    expect(bricksFit(model, [makeBrick({ id: 'n', x: 2 })], getPart, new Set(['a', 'b']))).toBe(true);
    expect(bricksFit(model, [makeBrick({ id: 'n', partId: 'nope' })], getPart)).toBe(false);
    expect(bricksFit(model, [makeBrick({ id: 'n', y: -3 })], getPart)).toBe(false);
  });

  it('lets no part stand in the very box a loose part stands in, which collisions do not see, unless the two are plugged together', () => {
    const SQUARE = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
    const QUARTER = [0, 0, 1, 0, 1, 0, -1, 0, 0] as const;
    // a head, loose as one set on a neck is
    const head = makeBrick({ id: 'head', partId: 'head', y: 5, m: SQUARE });
    const withHead = modelFromBricks([head]);
    // another in the same place: loose, on the grid, or turned a quarter in the same box
    expect(bricksFit(withHead, [{ ...head, id: 'n' }], connectorLookup)).toBe(false);
    expect(bricksFit(withHead, [makeBrick({ id: 'n', partId: 'head', y: 5 })], connectorLookup)).toBe(false);
    expect(bricksFit(withHead, [{ ...head, id: 'n', m: QUARTER }], connectorLookup)).toBe(false);
    // a loose part where one stands on the grid
    expect(bricksFit(modelFromBricks([makeBrick({ id: 'head', partId: 'head', y: 5 })]), [{ ...head, id: 'n' }], connectorLookup)).toBe(false);
    // beside it, a plate higher, or a part of another size at the same corner, is none of that; nor is the head itself, moved
    expect(bricksFit(withHead, [{ ...head, id: 'n', x: 1 }], connectorLookup)).toBe(true);
    expect(bricksFit(withHead, [{ ...head, id: 'n', y: 6 }], connectorLookup)).toBe(true);
    expect(bricksFit(withHead, [{ ...head, id: 'n', partId: 'bush' }], connectorLookup)).toBe(true);
    expect(bricksFit(withHead, [{ ...head, y: 5 }], connectorLookup, new Set(['head']))).toBe(true);
    // a part the library no longer has stands in nobody's way
    expect(bricksFit(modelFromBricks([{ ...head, partId: 'gone' }]), [{ ...head, id: 'n' }], connectorLookup)).toBe(true);
    // a 2 × 2 turntable's top fills the box its base does, plugged into it; a second top fills the first's
    const base = makeBrick({ id: 'base', partId: 'turn-base' });
    const top = makeBrick({ id: 'top', partId: 'turn-top', m: SQUARE });
    expect(bricksFit(modelFromBricks([base]), [top], connectorLookup)).toBe(true);
    expect(bricksFit(modelFromBricks([base, top]), [{ ...top, id: 'n' }], connectorLookup)).toBe(false);
  });

  it('holds the part being built as R, T, C and D turn, choose and push it, and a pasted copy as it fits best', () => {
    const copy = { bricks: [makeBrick({ id: 'p' })], size: { w: 2, h: 3, d: 4 }, grab: { x: 1, y: 1.5, z: 2 } };
    expect(buildTurn({ buildRotation: 0, buildVia: null, buildDepth: 0, pastePayload: null })).toEqual({ spin: 0, flipped: false });
    expect(buildTurn({ buildRotation: 0, buildVia: 2, buildDepth: 0, pastePayload: null })).toEqual({ spin: 0, flipped: false, via: 2 });
    expect(buildTurn({ buildRotation: 0, buildVia: 0, buildDepth: 0, pastePayload: null })).toEqual({ spin: 0, flipped: false, via: 0 });
    // turned a quarter by R, and over by T: about its top no more, upside down
    expect(buildTurn({ buildRotation: orientationFacing('+y', 1), buildVia: 1, buildDepth: 0, pastePayload: null })).toEqual({ spin: 1, flipped: false, via: 1 });
    expect(buildTurn({ buildRotation: orientationFacing('-y', 2), buildVia: null, buildDepth: 0, pastePayload: null })).toEqual({ spin: 2, flipped: true });
    // tipped onto a side, it is turned over too: T has turned it from standing as it is drawn
    expect(buildTurn({ buildRotation: orientationFacing('+x', 0), buildVia: null, buildDepth: 0, pastePayload: null })).toEqual({ spin: 0, flipped: true });
    // pushed by D past a stud into a hole, it says how far; a stud in, as it goes by itself, it says nothing
    expect(buildTurn({ buildRotation: 0, buildVia: null, buildDepth: 2, pastePayload: null })).toEqual({ spin: 0, flipped: false, deeper: 2 });
    expect(buildTurn({ buildRotation: orientationFacing('+y', 3), buildVia: 1, buildDepth: 1, pastePayload: null })).toEqual({ spin: 3, flipped: false, via: 1, deeper: 1 });
    // the connection chosen, the turn and the depth are the active part's: a pasted copy goes on as it fits best
    expect(buildTurn({ buildRotation: 0, buildVia: 2, buildDepth: 0, pastePayload: copy })).toEqual({ spin: 0, flipped: false });
    expect(buildTurn({ buildRotation: 0, buildVia: null, buildDepth: 2, pastePayload: copy })).toEqual({ spin: 0, flipped: false });
    expect(buildTurn({ buildRotation: orientationFacing('-y', 1), buildVia: null, buildDepth: 0, pastePayload: copy })).toEqual({ spin: 0, flipped: false });
  });

  it('measures world bounds with headroom for studs', () => {
    expect(worldBounds([], getPart)).toBeNull();
    const bounds = worldBounds(bricksOf(model), getPart);
    expect(bounds?.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds?.max.x).toBe(12);
    expect(bounds?.max.y).toBeCloseTo(6.5 * PLATE_HEIGHT);
    expect(bounds?.max.z).toBe(2);
  });
});
