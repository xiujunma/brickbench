import {
  Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { isOpaqueColor } from '../core/colors';
import type { Vec3 } from '../core/grid';
import { frameView } from '../core/instructions/camera';
import type { SceneSettings } from '../core/io/modelFile';
import { buildSpatialIndex } from '../core/model/spatial';
import { visibleStuds } from '../core/model/studs';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { worldBounds } from '../state/selectors';
import { BrickBatches } from './brickBatches';
import { GeometryCache } from './geometryCache';
import { Ground } from './ground';
import { MaterialLibrary } from './materials';
import type { MeshSource } from './meshStore';
import { studioEnvironment } from './environment';

const JPEG_QUALITY = 0.9;
const PAPER = '#ffffff';
/** New-part outlines stay this many pixels wide whatever the model's size. */
const OUTLINE_PIXELS = 4;

export interface InstructionRenderOptions {
  /** Draw the scene's baseplate under the model. */
  readonly baseplate: SceneSettings | null;
  /** Outline the parts each step adds. */
  readonly highlight: boolean;
  /** Where library part meshes come from. */
  readonly meshes?: MeshSource | null;
}

/**
 * Renders printable pictures of a model as it grows step by step, on white,
 * from one fixed orthographic view so every page lines up.
 */
export class InstructionRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  private readonly key = new DirectionalLight('#fff6ec', 2.1);
  private readonly geometries: GeometryCache;
  private readonly materials = new MaterialLibrary();
  private readonly earlier: BrickBatches;
  private readonly added: BrickBatches;
  private readonly ground: Ground;
  private direction: Vec3 = { x: 0, y: -1, z: -1 };
  private finished: readonly Brick[] = [];

  constructor(
    private readonly lookup: PartLookup,
    options: InstructionRenderOptions,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: true });
    let geometries: GeometryCache | null = null;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.05;

      this.scene.environment = studioEnvironment(this.renderer);
      this.scene.environmentIntensity = 0.6;
      this.scene.background = new Color(PAPER);

      geometries = new GeometryCache(lookup, options.meshes ?? null);
      this.geometries = geometries;
      this.earlier = new BrickBatches(this.geometries, this.materials, lookup, 'resting');
      this.added = new BrickBatches(this.geometries, this.materials, lookup, options.highlight ? 'highlight' : 'resting');
      this.ground = new Ground(this.geometries, this.materials, { floor: false });
      if (options.baseplate && options.baseplate.baseplateSize > 0) {
        this.ground.setBaseplate(options.baseplate.baseplateSize, options.baseplate.baseplateColor);
      }
      this.scene.add(
        new HemisphereLight('#f7f4ef', '#6d6458', 0.75),
        this.key,
        this.key.target,
        this.ground.group,
        this.earlier.group,
        this.added.group,
      );
    } catch (error: unknown) {
      // a half-built renderer must not keep its WebGL context alive, nor listen to the shared mesh store
      geometries?.dispose();
      this.scene.environment?.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }
  }

  /** Loads library meshes before drawing, so no step shows placeholders. Resolves with the parts that failed. */
  preload(partIds: Iterable<string>): Promise<string[]> {
    return this.geometries.preload(partIds);
  }

  /** Fixes the view for every picture: the finished model, seen along `direction`. */
  setView(finished: readonly Brick[], direction: Vec3): void {
    this.finished = finished;
    this.direction = direction;
  }

  /** Frames the finished model for a picture of this size; returns world units per pixel. */
  private aim(width: number, height: number): number {
    const bounds = worldBounds(this.finished, this.lookup);
    if (!bounds) return 0;
    const frame = frameView(bounds, this.direction, width / height);
    const distance = 200 + Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * 2;
    const camera = this.camera;
    camera.left = -frame.halfWidth;
    camera.right = frame.halfWidth;
    camera.top = frame.halfHeight;
    camera.bottom = -frame.halfHeight;
    camera.far = distance * 2;
    camera.up.set(frame.up.x, frame.up.y, frame.up.z);
    camera.position.set(
      frame.target.x - frame.forward.x * distance,
      frame.target.y - frame.forward.y * distance,
      frame.target.z - frame.forward.z * distance,
    );
    camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
    camera.updateProjectionMatrix();

    // light from over the viewer's left shoulder, so the faces facing the reader are lit
    const { target, forward, right, up } = frame;
    this.key.target.position.set(target.x, target.y, target.z);
    this.key.position.set(
      target.x + (-right.x * 0.6 + up.x * 1.3 - forward.x) * distance,
      target.y + (-right.y * 0.6 + up.y * 1.3 - forward.y) * distance,
      target.z + (-right.z * 0.6 + up.z * 1.3 - forward.z) * distance,
    );
    return (2 * frame.halfWidth) / width;
  }

  /**
   * The model after one step: `earlier` bricks as built so far, `added` the
   * bricks this step places (outlined when highlighting). Returns a JPEG.
   */
  renderStep(earlier: readonly Brick[], added: readonly Brick[], width: number, height: number): string {
    if (this.renderer.domElement.width !== width || this.renderer.domElement.height !== height) {
      this.renderer.setSize(width, height, false);
    }
    // size outlines for this picture before the batches build their outline meshes
    const unitsPerPixel = this.aim(width, height);
    if (unitsPerPixel > 0) this.added.setOutlineWidth(OUTLINE_PIXELS * unitsPerPixel);
    const all = [...earlier, ...added];
    const index = buildSpatialIndex(all, this.lookup);
    const colors = new Map(all.map((b) => [b.id, b.colorId]));
    const isOpaque = (id: string): boolean => isOpaqueColor(colors.get(id) ?? -1);
    this.earlier.update(earlier, visibleStuds(earlier, index, this.lookup, isOpaque));
    this.added.update(added, visibleStuds(added, index, this.lookup, isOpaque));
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  dispose(): void {
    this.earlier.dispose();
    this.added.dispose();
    this.ground.dispose();
    this.geometries.dispose();
    this.materials.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
