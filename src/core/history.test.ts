import { describe, expect, it } from 'bun:test';
import { canRedo, canUndo, createHistory, pushHistory, redo, squashSince, undo } from './history';

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistory('a');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('undoes and redoes changes', () => {
    const history = pushHistory(pushHistory(createHistory('a'), 'b'), 'c');
    const back = undo(history);
    expect(back.present).toBe('b');
    expect(undo(back).present).toBe('a');
    expect(redo(back).present).toBe('c');
  });

  it('drops the redo branch when something new happens', () => {
    const branched = pushHistory(undo(pushHistory(createHistory('a'), 'b')), 'x');
    expect(branched.present).toBe('x');
    expect(canRedo(branched)).toBe(false);
    expect(undo(branched).present).toBe('a');
  });

  it('ignores pushes that do not change anything', () => {
    const history = createHistory('a');
    expect(pushHistory(history, 'a')).toBe(history);
  });

  it('caps the number of undo steps', () => {
    let history = createHistory(0);
    for (let i = 1; i <= 10; i++) history = pushHistory(history, i, 3);
    expect(history.past).toEqual([7, 8, 9]);
  });

  it('folds the steps since a snapshot into one, so one undo returns to it', () => {
    let h = createHistory('start');
    h = pushHistory(h, 'before');
    for (const step of ['a', 'b', 'c']) h = pushHistory(h, step);
    const folded = squashSince(h, 'before');
    expect(folded).toEqual({ past: ['start', 'before'], present: 'c', future: [] });
    expect(undo(folded).present).toBe('before');
  });

  it('leaves history alone when there is nothing to fold or the snapshot is gone', () => {
    const one = pushHistory(createHistory('before'), 'after');
    expect(squashSince(one, 'before')).toBe(one);
    expect(squashSince(one, 'elsewhere')).toBe(one);
    // undone past the snapshot: its steps are the user's now
    const undone = undo(one);
    expect(squashSince(undone, 'after')).toBe(undone);
  });
});

