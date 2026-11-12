import { PMREMGenerator, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Reflection map size. On a GPU the full one costs nothing; where WebGL runs
 * on the CPU (virtual machines, CI) it takes seconds, and plastic looks much
 * the same with a small one.
 */
const ENVIRONMENT_SIZE = { gpu: 256, software: 64 } as const;

/** True when WebGL is drawn on the CPU rather than a graphics card. */
export function isSoftwareRenderer(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return typeof name === 'string' && SOFTWARE_RENDERERS.test(name);
}

/** Soft studio light for shiny bricks: a room around the model, blurred into a reflection map. */
export function studioEnvironment(renderer: WebGLRenderer, software = isSoftwareRenderer(renderer)): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  try {
    return pmrem.fromScene(room, 0.04, 0.1, 100, { size: software ? ENVIRONMENT_SIZE.software : ENVIRONMENT_SIZE.gpu }).texture;
  } finally {
    room.dispose();
    pmrem.dispose();
  }
}
