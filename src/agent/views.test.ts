import { describe, expect, it } from 'bun:test';
import { DEFAULT_VIEW_DIRECTION } from '../core/instructions/camera';
import { directionFor, VIEW_DIRECTIONS } from './views';

describe('which way the look tool looks', () => {
  it('looks the way each fixed view says, whatever the user’s camera does', () => {
    const user = { x: 1, y: -1, z: 0 };
    for (const view of ['iso', 'front', 'back', 'left', 'right', 'top'] as const) expect(directionFor(view, user)).toEqual(VIEW_DIRECTIONS[view]);
    expect(VIEW_DIRECTIONS.iso).toEqual(DEFAULT_VIEW_DIRECTION);
  });

  it('looks the way the user’s camera does for "user", or from the corner with no camera to go by', () => {
    const user = { x: 0.2, y: -0.6, z: -0.8 };
    expect(directionFor('user', user)).toEqual(user);
    expect(directionFor('user', null)).toEqual(DEFAULT_VIEW_DIRECTION);
  });
});
