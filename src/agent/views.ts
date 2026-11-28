/** Which way the look tool's camera looks, by the view an agent asks for; apart from the renderer, which loads only when an agent first looks. */
import type { Vec3 } from '../core/grid';
import { DEFAULT_VIEW_DIRECTION } from '../core/instructions/camera';
import type { View } from './protocol';

/** The fixed views. "front" faces +z, as the editor's home view does. */
export const VIEW_DIRECTIONS: Readonly<Record<Exclude<View, 'user'>, Vec3>> = {
  iso: DEFAULT_VIEW_DIRECTION,
  front: { x: 0, y: -0.35, z: -1 },
  back: { x: 0, y: -0.35, z: 1 },
  right: { x: -1, y: -0.35, z: 0 },
  left: { x: 1, y: -0.35, z: 0 },
  // straight down has no "up"; nearly straight down keeps the front at the bottom
  top: { x: 0, y: -0.97, z: -0.24 },
};

/** The direction for a view: "user" is the way the user's camera looks, or iso when there is none to go by. */
export function directionFor(view: View, user: Vec3 | null): Vec3 {
  if (view !== 'user') return VIEW_DIRECTIONS[view];
  return user ?? VIEW_DIRECTIONS.iso;
}
