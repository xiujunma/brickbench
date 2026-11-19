import { Group, Mesh, type Material } from 'three';
import { getColor } from '../core/colors';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { brickMatrix } from './brickBatches';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';

/**
 * The model as plain meshes, one node per brick sharing each part's mesh,
 * with the colours a part fixes (a wheel's tyre) as meshes under it. For
 * glTF export and photos, which want no instancing. `materialFor` gives the
 * material for a brick's colour; the library's solid one by default.
 */
export function modelGroup(
  bricks: readonly Brick[],
  lookup: PartLookup,
  geometries: GeometryCache,
  materials: MaterialLibrary,
  materialFor: (colorId: number) => Material = (colorId) => materials.solid(colorId),
): Group {
  const root = new Group();
  for (const brick of bricks) {
    const part = lookup(brick.partId);
    if (!part) continue;
    const body = geometries.part(brick.partId);
    const colour = getColor(brick.colorId)?.name ?? String(brick.colorId);
    // a part drawn wholly in colours of its own has nothing in the brick's colour
    const node = (body.getIndex()?.count ?? 1) > 0 ? new Mesh(body, materialFor(brick.colorId)) : new Group();
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
  return root;
}
