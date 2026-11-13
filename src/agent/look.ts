/** Draws the model for the look tool: the picture agents check their work with. */
import type { Vec3 } from '../core/grid';
import { DEFAULT_VIEW_DIRECTION } from '../core/instructions/camera';
import { getPart } from '../core/parts/catalog';
import { InstructionRenderer } from '../engine/instructionRenderer';
import { partLibrary } from '../state/library';
import type { LookRequest } from './execute';
import type { View } from './protocol';

/** Big enough to judge a build; small enough to stay well inside an agent's tool-output allowance. */
const WIDTH = 800;
const HEIGHT = 600;

/** Which way the camera looks. "front" faces +z, as the editor's home view does. */
export const VIEW_DIRECTIONS: Readonly<Record<View, Vec3>> = {
  iso: DEFAULT_VIEW_DIRECTION,
  front: { x: 0, y: -0.35, z: -1 },
  back: { x: 0, y: -0.35, z: 1 },
  right: { x: -1, y: -0.35, z: 0 },
  left: { x: 1, y: -0.35, z: 0 },
  // straight down has no "up"; nearly straight down keeps the front at the bottom
  top: { x: 0, y: -0.97, z: -0.24 },
};

export async function renderLook(request: LookRequest): Promise<{ readonly data: string; readonly mimeType: 'image/jpeg' }> {
  const renderer = new InstructionRenderer(getPart, {
    baseplate: request.settings,
    highlight: request.highlight.length > 0,
    meshes: partLibrary.meshes,
  });
  try {
    renderer.setView(request.bricks, VIEW_DIRECTIONS[request.view]);
    await renderer.preload(new Set(request.bricks.map((b) => b.partId)));
    const outlined = new Set(request.highlight.map((b) => b.id));
    const url = renderer.renderStep(
      request.bricks.filter((b) => !outlined.has(b.id)),
      request.bricks.filter((b) => outlined.has(b.id)),
      WIDTH,
      HEIGHT,
    );
    return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' };
  } finally {
    renderer.dispose();
  }
}
