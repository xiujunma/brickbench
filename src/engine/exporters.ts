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
    const body = geometries.part(brick.partId);
    const colour = getColor(brick.colorId)?.name ?? String(brick.colorId);
    // a part drawn wholly in colours of its own has nothing in the brick's colour
    const node = (body.getIndex()?.count ?? 1) > 0 ? new Mesh(body, materials.solid(brick.colorId)) : new Group();
    node.name = `${part.name} · ${colour}`;
    for (const layer of geometries.layers(brick.partId)) {
      const piece = new Mesh(layer.geometry, materials.fixed(layer));
      piece.name = `${part.name} · fixed colour ${layer.code}`;
      node.add(piece);
    }
    brickMatrix(brick, lookup, node.matrix);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    root.add(node);
  }

  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter did not return binary data');
  return new Blob([result], { type: 'model/gltf-binary' });
}
