import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { GeometryCache } from './geometryCache';
import type { MaterialLibrary } from './materials';
import { studioEnvironment } from './environment';

const SIZE = 96;
const VIEW_DIRECTION = new Vector3(1.1, 0.95, 1.45).normalize();

/** Renders small product shots of parts for the parts panel. */
export class ThumbnailRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.01, 200);
  private readonly mesh = new Mesh();
  /** The colours a library part fixes, drawn over its body. */
  private readonly layers = new Group();

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
      this.scene.environment = studioEnvironment(this.renderer);
    } catch (error: unknown) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }
    this.scene.environmentIntensity = 0.6;
    const key = new DirectionalLight('#fff4e8', 2.2);
    key.position.set(3, 6, 4);
    this.scene.add(new HemisphereLight('#f5f1ea', '#6d6458', 0.7), key, this.mesh, this.layers);
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
    this.layers.clear();
    for (const layer of this.geometries.layers(partId)) this.layers.add(new Mesh(layer.geometry, this.materials.fixed(layer)));
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
