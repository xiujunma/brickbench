import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';

const SIZE = 96;
const VIEW_DIRECTION = new Vector3(1.1, 0.95, 1.45).normalize();

/** Renders small product shots of parts for the parts panel. */
export class ThumbnailRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.01, 200);
  private readonly mesh = new Mesh();

  constructor(
    private readonly geometries: GeometryCache,
    private readonly materials: MaterialLibrary,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(2);
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    try {
      const pmrem = new PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch (error: unknown) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }
    this.scene.environmentIntensity = 0.6;
    const key = new DirectionalLight('#fff4e8', 2.2);
    key.position.set(3, 6, 4);
    this.scene.add(new HemisphereLight('#f5f1ea', '#6d6458', 0.7), key, this.mesh);
  }

  /**
   * Returns a PNG data URL of the part in the given colour. With `minRadius`
   * parts smaller than that are drawn smaller instead of filling the frame,
   * so relative sizes stay readable.
   */
  render(partId: string, colorId: number, minRadius = 0): string {
    const geometry = this.geometries.part(partId);
    this.mesh.geometry = geometry;
    this.mesh.material = this.materials.solid(colorId);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere ?? new Sphere(new Vector3(), 1);
    const radius = Math.max(sphere.radius, minRadius);
    const distance = (radius / Math.sin((this.camera.fov / 2) * (Math.PI / 180))) * 1.02;
    this.camera.position.copy(sphere.center).addScaledVector(VIEW_DIRECTION, distance);
    this.camera.lookAt(sphere.center);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
