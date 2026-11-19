/**
 * Photo-quality stills: the model path traced (three-gpu-pathtracer), with
 * light bouncing between bricks, soft shadows, reflections and real glass
 * for transparent colours. Slow, so it reports progress and can be stopped;
 * loaded only when a photo is asked for.
 */
import {
  CircleGeometry,
  Color,
  DirectionalLight,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { getColor } from '../core/colors';
import type { Vec3 } from '../core/grid';
import type { SceneSettings } from '../core/io/modelFile';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { buildBaseplateGeometry, buildStudGeometry } from './geometry/partGeometry';
import { GeometryCache } from './geometryCache';
import { BASEPLATE_THICKNESS } from './ground';
import { BACKDROP_BOTTOM, BACKDROP_TOP, fitKeyLight, type Bounds3 } from './lighting';
import { MaterialLibrary } from './materials';
import type { MeshSource } from './meshStore';
import { modelGroup } from './modelScene';

export interface PhotoCamera {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical field of view, in degrees. */
  readonly fov: number;
}

export interface PhotoRequest {
  readonly bricks: readonly Brick[];
  readonly settings: SceneSettings;
  readonly bounds: Bounds3;
  readonly camera: PhotoCamera;
  readonly width: number;
  readonly height: number;
  /** Samples per pixel: more is smoother and slower. */
  readonly samples: number;
}

/** How many samples were done, of how many. */
export type PhotoProgress = (done: number, total: number) => void;

/** How bright the sky lights the model, with the key light for shadows. */
const SKY_LIGHT = 1;
const FLOOR_RADIUS = 400;
/** Light bounces per path: enough for corners and glass, not so many that a sample crawls. */
const BOUNCES = 6;

/** Gives the browser a frame between samples, so the page stays responsive. */
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Transparent colours as glass, the rest as the editor draws them. */
function photoMaterial(materials: MaterialLibrary): (colorId: number) => Material {
  const glass = new Map<number, MeshPhysicalMaterial>();
  return (colorId) => {
    const colour = getColor(colorId);
    if (colour?.finish !== 'transparent') return materials.solid(colorId);
    let material = glass.get(colorId);
    if (!material) {
      material = new MeshPhysicalMaterial({ color: colour.hex, roughness: 0.05, transmission: 1, ior: 1.49, thickness: 0.5 });
      glass.set(colorId, material);
    }
    return material;
  };
}

/** The baseplate with its studs merged into one mesh: the path tracer takes no instancing. */
function baseplate(settings: SceneSettings, materials: MaterialLibrary): Mesh | null {
  const size = settings.baseplateSize;
  if (size <= 0) return null;
  const stud = buildStudGeometry();
  const studs: BufferGeometry[] = [];
  const at = new Matrix4();
  for (let x = -size / 2; x < size / 2; x++) {
    for (let z = -size / 2; z < size / 2; z++) studs.push(stud.clone().applyMatrix4(at.makeTranslation(x + 0.5, 0, z + 0.5)));
  }
  const geometry = mergeGeometries([buildBaseplateGeometry(size, BASEPLATE_THICKNESS), ...studs]);
  stud.dispose();
  for (const piece of studs) piece.dispose();
  return new Mesh(geometry, materials.solid(settings.baseplateColor));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Making the photo was stopped.', 'AbortError');
}

/** Path traces the model as the request frames it, and gives it back as a PNG. */
export async function renderPhoto(
  request: PhotoRequest,
  lookup: PartLookup,
  meshes: MeshSource | null,
  onProgress?: PhotoProgress,
  signal?: AbortSignal,
): Promise<Blob> {
  const { width, height, samples } = request;
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  const geometries = new GeometryCache(lookup, meshes);
  const materials = new MaterialLibrary();
  const disposables: { dispose(): void }[] = [];
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;

    const failed = await geometries.preload(request.bricks.map((b) => b.partId));
    if (failed.length > 0) throw new Error(`${failed.length === 1 ? '1 LDraw library part' : `${failed.length} LDraw library parts`} could not be loaded. Check your connection and try again.`);
    throwIfAborted(signal);

    const scene = new Scene();
    scene.add(modelGroup(request.bricks, lookup, geometries, materials, photoMaterial(materials)));
    const plate = baseplate(request.settings, materials);
    if (plate) {
      scene.add(plate);
      disposables.push(plate.geometry);
    }
    const floorMaterial = new MeshStandardMaterial({ color: BACKDROP_BOTTOM, roughness: 0.9 });
    const floor = new Mesh(new CircleGeometry(FLOOR_RADIUS, 64), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = (request.settings.baseplateSize > 0 ? -BASEPLATE_THICKNESS : 0) - 0.002;
    scene.add(floor);
    disposables.push(floor.geometry, floorMaterial);

    // a sky the path tracer can light with as it is: it turns cube maps into skies with a shader three.js no longer has
    const sky = new GradientEquirectTexture();
    sky.topColor.set(new Color(BACKDROP_TOP));
    sky.bottomColor.set(new Color(BACKDROP_BOTTOM));
    sky.update();
    disposables.push(sky);
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = SKY_LIGHT;
    const key = new DirectionalLight('#fff4e8', 2.3);
    fitKeyLight(key, request.bounds);
    scene.add(key, key.target);

    const { position, target, fov } = request.camera;
    const camera = new PerspectiveCamera(fov, width / height, 0.1, 4000);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(target.x, target.y, target.z);

    const tracer = new WebGLPathTracer(renderer);
    disposables.push(tracer);
    tracer.bounces = BOUNCES;
    tracer.filterGlossyFactor = 0.5;
    tracer.renderDelay = 0;
    tracer.minSamples = 0;
    tracer.fadeDuration = 0;
    tracer.rasterizeScene = false;
    tracer.dynamicLowRes = false;
    // builds the ray-tracing structure here, a moment's pause for big models (setSceneAsync would need a worker)
    tracer.setScene(scene, camera);
    await nextFrame();
    throwIfAborted(signal);

    while (tracer.samples < samples) {
      tracer.renderSample();
      onProgress?.(Math.min(Math.floor(tracer.samples), samples), samples);
      await nextFrame();
      throwIfAborted(signal);
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be saved.'))), 'image/png');
    });
  } finally {
    for (const item of disposables) item.dispose();
    geometries.dispose();
    materials.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
