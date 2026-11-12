import {
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  MOUSE,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Spherical,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../core/grid';
import type { Ray } from '../core/placement/ray';
import { isSoftwareRenderer, studioEnvironment } from './environment';

const FOV = 35;
const HOME_DISTANCE = 38;
const HOME_POLAR = (54 * Math.PI) / 180;
const HOME_AZIMUTH = (38 * Math.PI) / 180;
const SHADOW_MAP_SIZE = 4096;
const MIN_SHADOW_EXTENT = 20;
const BACKDROP_TOP = '#f6f3ee';
const BACKDROP_BOTTOM = '#d9d3c8';

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

function backdropTexture(): CanvasTexture {
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

/**
 * Owns the WebGL renderer, scene, camera and orbit controls. Renders on
 * demand: call requestRender() after changing anything in the scene.
 */
export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 3000);
  readonly controls: OrbitControls;
  /** Everything that belongs to the model lives under this group. */
  readonly world = new Group();
  private readonly keyLight = new DirectionalLight('#fff4e8', 2.3);
  private readonly resizeObserver: ResizeObserver;
  private readonly backdrop = backdropTexture();
  private frame = 0;
  private dirty = true;
  private disposed = false;

  /** True when WebGL runs on the CPU; shadows and high pixel ratios are skipped there. */
  readonly softwareRendering: boolean;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, stencil: true });
    this.softwareRendering = isSoftwareRenderer(this.renderer);
    this.renderer.setPixelRatio(this.softwareRendering ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.softwareRendering;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.setupScene();
    this.controls = this.setupControls();
    this.resetView(false);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  private setupScene(): void {
    this.scene.environment = studioEnvironment(this.renderer, this.softwareRendering);
    this.scene.environmentIntensity = 0.55;
    this.scene.background = this.backdrop;

    const fill = new HemisphereLight('#f5f1ea', '#6d6458', 0.55);
    this.scene.add(fill);

    const light = this.keyLight;
    light.position.set(22, 40, 16);
    light.castShadow = true;
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.025;
    light.shadow.radius = 3;
    this.scene.add(light, light.target);
    this.fitShadows({ min: { x: -16, y: 0, z: -16 }, max: { x: 16, y: 4, z: 16 } });

    this.scene.add(this.world);
  }

  private setupControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 2;
    controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    controls.addEventListener('change', () => this.requestRender());
    return controls;
  }

  requestRender(): void {
    this.dirty = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Keeps the shadow camera tight around the model so shadows stay crisp. */
  fitShadows(bounds: Bounds3): void {
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    const extent = Math.max(
      MIN_SHADOW_EXTENT,
      (bounds.max.x - bounds.min.x) / 2 + 4,
      (bounds.max.z - bounds.min.z) / 2 + 4,
      (bounds.max.y - bounds.min.y) / 2 + 4,
    );
    const light = this.keyLight;
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
    this.requestRender();
  }

  /** Ray from the camera through a point on screen, in world units. */
  rayFromClient(clientX: number, clientY: number): Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const origin = new Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dir = new Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(origin).normalize();
    return { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }

  /** Projects a world point to client coordinates; null when it is behind the camera. */
  worldToClient(point: Vec3): { x: number; y: number } | null {
    const v = new Vector3(point.x, point.y, point.z).project(this.camera);
    if (v.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Unit vector the camera looks along. */
  viewDirection(): Vec3 {
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    return { x: forward.x, y: forward.y, z: forward.z };
  }

  /** Camera "forward" flattened onto the ground, for camera-relative nudging. */
  groundForward(): { x: number; z: number } {
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    return { x: forward.x, z: forward.z };
  }

  frame3(bounds: Bounds3): void {
    const centre = new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const radius = Math.max(
      2,
      new Vector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z).length() / 2,
    );
    const distance = radius / Math.sin(((FOV / 2) * Math.PI) / 180) * 1.1;
    const offset = new Vector3().subVectors(this.camera.position, this.controls.target).setLength(distance);
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).add(offset);
    this.controls.update();
    this.requestRender();
  }

  resetView(render = true): void {
    const offset = new Vector3().setFromSpherical(new Spherical(HOME_DISTANCE, HOME_POLAR, HOME_AZIMUTH));
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(offset);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    if (render) this.requestRender();
  }

  /** Renders a frame immediately and returns it as a PNG. */
  async capturePng(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the view'))), 'image/png');
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
