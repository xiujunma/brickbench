import { describe, expect, it } from 'bun:test';
import type { Brick } from '../core/model/types';
import { MAX_LISTED, requestContext } from './attachments';
import { MAX_CONTEXT_LENGTH } from './protocol';

const brick = (id: string, x = 0): Brick => ({ id, partId: '3001', colorId: 4, x, y: 0, z: 0, r: 0 }) as Brick;

describe('what goes with a request', () => {
  it('is nothing when nothing is selected and the view stays home', () => {
    expect(requestContext({ selected: [], view: false })).toEqual({ context: null, note: null });
  });

  it('lists one selected brick for the agent, with its id, and notes it for the user', () => {
    const { context, note } = requestContext({ selected: [brick('b1', 40)], view: false });
    expect(note).toBe('With 1 selected brick.');
    expect(context).toContain('The user has 1 brick selected in BrickBench, so "this" or "these" most likely means it');
    expect(context).toContain('{"id":"b1","part":"3001","color":4,"x":40,"y":0,"z":0,"r":0}');
  });

  it('lists several selected bricks, one line each', () => {
    const { context, note } = requestContext({ selected: [brick('b1'), brick('b2'), brick('b3')], view: false });
    expect(note).toBe('With 3 selected bricks.');
    expect(context).toContain('The user has 3 bricks selected');
    expect(context).toContain('means them');
    expect(context?.split('\n').filter((line) => line.startsWith('{"id"'))).toHaveLength(3);
  });

  it('counts the bricks past the most it lists', () => {
    const many = Array.from({ length: MAX_LISTED + 5 }, (_, i) => brick(`b${i}`));
    const { context, note } = requestContext({ selected: many, view: false });
    expect(note).toBe(`With ${MAX_LISTED + 5} selected bricks.`);
    expect(context?.split('\n').filter((line) => line.startsWith('{"id"'))).toHaveLength(MAX_LISTED);
    expect(context).toContain('and 5 more, which get_model lists.');
  });

  it('stays within what the bridge takes, however long the bricks’ ids', () => {
    const long = Array.from({ length: MAX_LISTED }, (_, i) => brick(`${'x'.repeat(400)}-${i}`));
    const { context } = requestContext({ selected: long, view: true });
    expect(context?.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
    const shown = context?.split('\n').filter((line) => line.startsWith('{"id"')).length ?? 0;
    expect(shown).toBeLessThan(MAX_LISTED);
    expect(context).toContain(`and ${MAX_LISTED - shown} more, which get_model lists.`);
  });

  it('tells the agent to look from the user’s view when it goes along', () => {
    const { context, note } = requestContext({ selected: [], view: true });
    expect(note).toBe('With your view.');
    expect(context).toBe('The user has attached their view: call look with view "user" to see the model from where they look at it.');
  });

  it('notes both when both go along', () => {
    const { context, note } = requestContext({ selected: [brick('b1'), brick('b2')], view: true });
    expect(note).toBe('With 2 selected bricks and your view.');
    expect(context?.indexOf('selected in BrickBench')).toBeLessThan(context?.indexOf('attached their view') ?? -1);
  });
});
