import type { Object3D } from 'three';

/**
 * Marks an object (with what is under it) as darkening nothing under
 * ambient occlusion: outlines, previews, the hover box. Apart from
 * ambientOcclusion.ts, so marking objects needs none of its GPU code.
 */
export function castsNoOcclusion(object: Object3D): void {
  object.userData['occludes'] = false;
}

/** Whether ambient occlusion should leave an object out. */
export function castsOcclusion(object: Object3D): boolean {
  return object.userData['occludes'] !== false;
}
