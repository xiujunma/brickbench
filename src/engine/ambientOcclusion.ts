/**
 * Ambient occlusion: bricks darken a little where they meet and in the
 * corners between them, as real ones do in soft light. A GTAO pass (three.js)
 * between rendering the scene and the output (tone mapping, sRGB).
 */
import { HalfFloatType, WebGLRenderTarget, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { castsOcclusion } from './occlusionMark';

/** In stud pitches: how far a brick darkens its neighbours. */
const RADIUS = 1.2;
/** How dark the corners get: 1 is the full effect. */
const STRENGTH = 1;
const SAMPLES = 16;
/** Edges stay smooth: the scene renders into a multisampled target, as it would to the screen. */
const MSAA_SAMPLES = 4;

/** GTAO that leaves out objects marked by castsNoOcclusion (occlusionMark.ts) while it works out where it is dark. */
class BrickOcclusionPass extends GTAOPass {
  constructor(
    private readonly occluders: Scene,
    camera: Camera,
    width: number,
    height: number,
  ) {
    super(occluders, camera, width, height);
  }

  override render(...args: Parameters<GTAOPass['render']>): void {
    const hidden: Object3D[] = [];
    this.occluders.traverseVisible((object) => {
      if (!castsOcclusion(object)) hidden.push(object);
    });
    for (const object of hidden) object.visible = false;
    try {
      super.render(...args);
    } finally {
      for (const object of hidden) object.visible = true;
    }
  }
}

/** Renders a scene with ambient occlusion, in place of renderer.render(scene, camera). */
export class AmbientOcclusion {
  private readonly composer: EffectComposer;
  private readonly pass: BrickOcclusionPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, width: number, height: number) {
    const ratio = renderer.getPixelRatio();
    // a stencil, as selection outlines draw only where the selected bricks are not
    const target = new WebGLRenderTarget(width * ratio, height * ratio, { type: HalfFloatType, stencilBuffer: true, samples: MSAA_SAMPLES });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new BrickOcclusionPass(scene, camera, width * ratio, height * ratio);
    this.pass.updateGtaoMaterial({ radius: RADIUS, distanceExponent: 1, thickness: 1, scale: 1, samples: SAMPLES, distanceFallOff: 1, screenSpaceRadius: false });
    this.pass.blendIntensity = STRENGTH;
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.pass.dispose();
    this.composer.dispose();
  }
}
