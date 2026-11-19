import { Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';
import { modelGroup } from './modelScene';

/** glTF is in metres; one stud pitch is 8 mm. */
const METRES_PER_UNIT = 0.008;

/**
 * Exports the model as a binary glTF (.glb) at real-world scale, one node per
 * brick sharing mesh data per part, ready for Blender or any glTF viewer.
 */
export async function exportGlb(
  name: string,
  bricks: readonly Brick[],
  lookup: PartLookup,
  geometries: GeometryCache,
  materials: MaterialLibrary,
): Promise<Blob> {
  const scene = new Scene();
  const root = modelGroup(bricks, lookup, geometries, materials);
  root.name = name;
  root.scale.setScalar(METRES_PER_UNIT);
  scene.add(root);

  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter did not return binary data');
  return new Blob([result], { type: 'model/gltf-binary' });
}
