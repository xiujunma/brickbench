/** The editor's look, shared by everything that draws the model in it: its backdrop and its key light. */
import { CanvasTexture, SRGBColorSpace, type DirectionalLight } from 'three';
import type { Vec3 } from '../core/grid';

const MIN_SHADOW_EXTENT = 20;
export const BACKDROP_TOP = '#f6f3ee';
export const BACKDROP_BOTTOM = '#d9d3c8';

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A soft vertical gradient behind the model. */
export function backdropTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, BACKDROP_TOP);
    gradient.addColorStop(1, BACKDROP_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Puts the key light above and to the front right of the model, its shadow camera tight around it so shadows stay crisp. */
export function fitKeyLight(light: DirectionalLight, bounds: Bounds3): void {
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  const extent = Math.max(
    MIN_SHADOW_EXTENT,
    (bounds.max.x - bounds.min.x) / 2 + 4,
    (bounds.max.z - bounds.min.z) / 2 + 4,
    (bounds.max.y - bounds.min.y) / 2 + 4,
  );
  light.target.position.set(cx, 0, cz);
  light.position.set(cx + extent * 0.7, extent * 1.6 + bounds.max.y, cz + extent * 0.5);
  const camera = light.shadow.camera;
  camera.left = -extent * 1.25;
  camera.right = extent * 1.25;
  camera.top = extent * 1.25;
  camera.bottom = -extent * 1.25;
  camera.near = 0.5;
  camera.far = extent * 6 + bounds.max.y * 2;
  camera.updateProjectionMatrix();
}
