/**
 * A model's picture for the gallery: the whole model, from the angle the
 * building instructions use, on white, drawn the way their pages are.
 */
import { DEFAULT_VIEW_DIRECTION } from '../core/instructions/camera';
import type { SceneSettings } from '../core/io/modelFile';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { InstructionRenderer } from './instructionRenderer';
import type { MeshSource } from './meshStore';

export const THUMBNAIL_WIDTH = 480;
export const THUMBNAIL_HEIGHT = 360;

/** A JPEG data URL of the model; throws when WebGL cannot draw it. */
export async function renderModelThumbnail(
  bricks: readonly Brick[],
  settings: SceneSettings,
  lookup: PartLookup,
  meshes: MeshSource | null,
): Promise<string> {
  const renderer = new InstructionRenderer(lookup, { baseplate: settings, highlight: false, meshes });
  try {
    await renderer.preload(new Set(bricks.map((brick) => brick.partId)));
    renderer.setView(bricks, DEFAULT_VIEW_DIRECTION, settings.baseplateSize > 0);
    return renderer.renderStep([], bricks, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  } finally {
    renderer.dispose();
  }
}
