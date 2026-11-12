import {
  CircleGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  ShadowMaterial,
  type BufferGeometry,
} from 'three';
import type { GroundBounds } from '../core/placement/ray';
import { buildBaseplateGeometry } from './geometry/partGeometry';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';

export const BASEPLATE_THICKNESS = 0.16;
const FLOOR_RADIUS = 600;

/**
 * The building surface: an optional studded baseplate with its top at y = 0,
 * over a floor that only shows shadows and a faint grid.
 */
export class Ground {
  readonly group = new Group();
  private readonly floor: Mesh<CircleGeometry, ShadowMaterial>;
  private readonly grid: GridHelper;
  private plate: Mesh | null = null;
  private plateGeometry: BufferGeometry | null = null;
  private studs: InstancedMesh | null = null;
  private size = 0;

  constructor(
    private readonly geometries: GeometryCache,
    private readonly materials: MaterialLibrary,
    options: { readonly floor?: boolean } = {},
  ) {
    this.floor = new Mesh(new CircleGeometry(FLOOR_RADIUS, 72), new ShadowMaterial({ opacity: 0.16 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.grid = new GridHelper(256, 64, '#b3aa9c', '#c9c2b6');
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.45;
      material.depthWrite = false;
    }
    // printed instructions skip the shadow floor and grid
    if (options.floor !== false) this.group.add(this.floor, this.grid);
  }

  setBaseplate(size: number, colorId: number): void {
    this.clearPlate();
    this.size = size;
    const floorY = size > 0 ? -BASEPLATE_THICKNESS : 0;
    this.floor.position.y = floorY - 0.002;
    this.grid.position.y = floorY - 0.001;
    if (size <= 0) return;

    const material = this.materials.solid(colorId);
    this.plateGeometry = buildBaseplateGeometry(size, BASEPLATE_THICKNESS);
    this.plate = new Mesh(this.plateGeometry, material);
    this.plate.receiveShadow = true;

    const studs = new InstancedMesh(this.geometries.stud('low'), material, size * size);
    const matrix = new Matrix4();
    let i = 0;
    for (let x = -size / 2; x < size / 2; x++) {
      for (let z = -size / 2; z < size / 2; z++) {
        studs.setMatrixAt(i++, matrix.makeTranslation(x + 0.5, 0, z + 0.5));
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    studs.receiveShadow = true;
    studs.computeBoundingSphere();
    this.studs = studs;
    this.group.add(this.plate, studs);
  }

  /** Where the ground can be built on; null means anywhere on the grid. */
  bounds(): GroundBounds | null {
    if (this.size <= 0) return null;
    const half = this.size / 2;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }

  private clearPlate(): void {
    if (this.plate) this.group.remove(this.plate);
    if (this.studs) {
      this.group.remove(this.studs);
      this.studs.dispose();
    }
    this.plateGeometry?.dispose();
    this.plate = null;
    this.studs = null;
    this.plateGeometry = null;
  }

  dispose(): void {
    this.clearPlate();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.grid.dispose();
  }
}
