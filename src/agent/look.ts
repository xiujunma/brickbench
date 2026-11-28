/** Draws the model for the look tool: the picture agents check their work with. */
import { getPart } from '../core/parts/catalog';
import { InstructionRenderer } from '../engine/instructionRenderer';
import { partLibrary } from '../state/library';
import type { LookRequest } from './execute';

/** Big enough to judge a build; small enough to stay well inside an agent's tool-output allowance. */
const WIDTH = 800;
const HEIGHT = 600;

export async function renderLook(request: LookRequest): Promise<{ readonly data: string; readonly mimeType: 'image/jpeg' }> {
  const renderer = new InstructionRenderer(getPart, {
    baseplate: request.settings,
    highlight: request.highlight.length > 0,
    meshes: partLibrary.meshes,
  });
  try {
    renderer.setView(request.bricks, request.direction);
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
