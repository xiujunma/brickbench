import { Group, Mesh, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { getColor } from '../core/colors';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { brickMatrix } from './brickBatches';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';

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
  const root = new Group();
  root.name = name;
  root.scale.setScalar(METRES_PER_UNIT);
  scene.add(root);

  for (const brick of bricks) {
    const part = lookup(brick.partId);
    if (!part) continue;
    const mesh = new Mesh(geometries.part(brick.partId), materials.solid(brick.colorId));
    mesh.name = `${part.name} · ${getColor(brick.colorId)?.name ?? brick.colorId}`;
    brickMatrix(brick, lookup, mesh.matrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    root.add(mesh);
  }

  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter did not return binary data');
  return new Blob([result], { type: 'model/gltf-binary' });
}
