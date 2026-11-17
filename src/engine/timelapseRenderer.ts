import {
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Texture,
} from 'three';
import { isOpaqueColor } from '../core/colors';
import type { SceneSettings } from '../core/io/modelFile';
import { buildSpatialIndex } from '../core/model/spatial';
import { visibleStuds, type StudInstance } from '../core/model/studs';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import type { CameraPose, FrameBricks } from '../core/timelapse/timeline';
import { BrickBatches } from './brickBatches';
import { isSoftwareRenderer, studioEnvironment } from './environment';
import { GeometryCache } from './geometryCache';
import { Ground } from './ground';
import { backdropTexture, fitKeyLight, type Bounds3 } from './lighting';
import { MaterialLibrary } from './materials';
import type { MeshSource } from './meshStore';

/** The editor's field of view, so the video looks like the model on screen. */
export const VIDEO_FOV = 35;
const SHADOW_MAP_SIZE = 2048;
const COUNTER_FONT = '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif';

export interface TimelapseRenderOptions {
  readonly width: number;
  readonly height: number;
  /** The scene's baseplate, drawn under the model. */
  readonly settings: SceneSettings;
  /** Where library part meshes come from. */
  readonly meshes?: MeshSource | null;
}

/** The studs a set of bricks shows: those no opaque brick of the same set covers. */
function studsOf(bricks: readonly Brick[], lookup: PartLookup) {
  const index = buildSpatialIndex(bricks, lookup);
  const colors = new Map(bricks.map((b) => [b.id, b.colorId]));
  return visibleStuds(bricks, index, lookup, (id) => isOpaqueColor(colors.get(id) ?? -1));
}

/**
 * Draws the frames of a time-lapse: the model as built so far, with bricks
 * dropping into place, in the editor's light and backdrop, from a moving
 * camera. Each frame lands on `canvas` with an optional caption over it.
 */
export class TimelapseRenderer {
  /** The finished frames, caption included: what the video is made of. */
  readonly canvas: HTMLCanvasElement;
  private readonly frame: CanvasRenderingContext2D;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly key = new DirectionalLight('#fff4e8', 2.3);
  private readonly backdrop: Texture;
  private readonly geometries: GeometryCache;
  private readonly materials = new MaterialLibrary();
  private readonly landed: BrickBatches;
  private readonly falling: BrickBatches;
  private readonly ground: Ground;
  /** Landed bricks drawn now; -1 before the first frame. */
  private landedCount = -1;

  constructor(
    private readonly lookup: PartLookup,
    private readonly options: TimelapseRenderOptions,
  ) {
    const { width, height } = options;
    this.camera = new PerspectiveCamera(VIDEO_FOV, width / height, 0.1, 4000);
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.backdrop = backdropTexture();
    let geometries: GeometryCache | null = null;
    try {
      const shadows = !isSoftwareRenderer(this.renderer);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = shadows;
      this.renderer.shadowMap.type = PCFShadowMap;

      this.scene.environment = studioEnvironment(this.renderer, !shadows);
      this.scene.environmentIntensity = 0.55;
      this.scene.background = this.backdrop;
      this.key.castShadow = shadows;
      this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      this.key.shadow.bias = -0.0002;
      this.key.shadow.normalBias = 0.025;
      this.key.shadow.radius = 3;

      geometries = new GeometryCache(lookup, options.meshes ?? null);
      this.geometries = geometries;
      this.landed = new BrickBatches(this.geometries, this.materials, lookup, 'resting');
      this.falling = new BrickBatches(this.geometries, this.materials, lookup, 'resting');
      this.ground = new Ground(this.geometries, this.materials);
      if (options.settings.baseplateSize > 0) this.ground.setBaseplate(options.settings.baseplateSize, options.settings.baseplateColor);
      this.scene.add(new HemisphereLight('#f5f1ea', '#6d6458', 0.55), this.key, this.key.target, this.ground.group, this.landed.group, this.falling.group);

      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      const frame = this.canvas.getContext('2d');
      if (!frame) throw new Error('This browser cannot draw video frames.');
      this.frame = frame;
    } catch (error: unknown) {
      // a half-built renderer must not keep its WebGL context alive, nor listen to the shared mesh store
      geometries?.dispose();
      this.scene.environment?.dispose();
      this.backdrop.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }
  }

  /** Loads library meshes before filming, so no frame shows a stand-in box. Resolves with the parts that failed. */
  preload(partIds: Iterable<string>): Promise<string[]> {
    return this.geometries.preload(partIds);
  }

  /** Lights the finished model: shadows sized to it for the whole video. */
  light(bounds: Bounds3): void {
    fitKeyLight(this.key, bounds);
  }

  /**
   * Draws one frame onto `canvas`, with `caption` in the bottom left corner
   * if given. `landedStuds` are the studs the landed bricks show (see
   * scheduleStuds); landed bricks are drawn again only when more have landed.
   */
  render(bricks: FrameBricks, landedStuds: () => readonly StudInstance[], pose: CameraPose, caption: string | null): void {
    if (this.renderer.getContext().isContextLost()) throw new Error('The graphics card stopped drawing. Close other tabs that use 3D and try again.');
    const { width, height } = this.options;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    // shift the lens so the middle of the model is the middle of the picture
    this.camera.setViewOffset(width, height, (pose.shift.x * width) / 2, (-pose.shift.y * height) / 2, width, height);
    if (bricks.landed.length !== this.landedCount) {
      this.landed.update(bricks.landed, landedStuds());
      this.landedCount = bricks.landed.length;
    }
    // falling bricks keep their own studs until they land
    this.falling.update(bricks.falling, studsOf(bricks.falling, this.lookup));
    this.renderer.render(this.scene, this.camera);
    this.frame.drawImage(this.renderer.domElement, 0, 0);
    if (caption) this.caption(caption);
  }

  /** White text on a soft dark pill, sized to the video. */
  private caption(text: string): void {
    const ctx = this.frame;
    const { width, height } = this.options;
    const size = Math.round(Math.min(width, height) * 0.034);
    const pad = Math.round(size * 0.6);
    const margin = Math.round(Math.min(width, height) * 0.04);
    ctx.font = `600 ${size}px ${COUNTER_FONT}`;
    const boxWidth = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const boxHeight = Math.round(size * 1.7);
    const y = height - margin - boxHeight;
    ctx.fillStyle = 'rgba(29, 26, 22, 0.62)';
    ctx.beginPath();
    ctx.roundRect(margin, y, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, margin + pad, y + boxHeight / 2 + size * 0.04);
  }

  dispose(): void {
    this.landed.dispose();
    this.falling.dispose();
    this.ground.dispose();
    this.geometries.dispose();
    this.materials.dispose();
    this.scene.environment?.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
