import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  SRGBColorSpace,
  type Material,
} from 'three';
import { getColor, type ColorFinish } from '../core/colors';

interface FinishLook {
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number;
}

const FINISHES: Readonly<Record<ColorFinish, FinishLook>> = {
  solid: { roughness: 0.3, metalness: 0, opacity: 1 },
  transparent: { roughness: 0.06, metalness: 0, opacity: 0.5 },
  pearl: { roughness: 0.36, metalness: 0.55, opacity: 1 },
  chrome: { roughness: 0.1, metalness: 1, opacity: 1 },
};

export const SELECTION_TINT = '#ff6b2c';
const INVALID_TINT = '#e5484d';
const FALLBACK_HEX = '#9a9a9a';
/** Outline thickness in world units (one stud = 1). */
export const OUTLINE_WIDTH = 0.04;
/** Stencil value outlined bricks leave behind; outlines only draw where it is absent. */
export const OUTLINE_STENCIL = 1;
/** Outlines draw after every brick, transparent ones included, so the stencil is complete. */
export const OUTLINE_RENDER_ORDER = 3;

export type OutlineTone = 'selection' | 'invalid' | 'contrast';

const OUTLINE_COLORS: Readonly<Record<OutlineTone, string>> = {
  selection: SELECTION_TINT,
  invalid: INVALID_TINT,
  contrast: '#ffffff',
};

const HIGHLIGHT_WARM = SELECTION_TINT;
const HIGHLIGHT_COOL = '#1f6feb';

/**
 * A highlight colour that stands out against a brick: blue on reds, oranges,
 * yellows and tans (where orange would vanish), orange on everything else.
 */
export function highlightFor(colorId: number): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(colorHex(colorId)).getHSL(hsl, SRGBColorSpace);
  const warm = hsl.s > 0.25 && (hsl.h < 0.17 || hsl.h > 0.94);
  return warm ? HIGHLIGHT_COOL : HIGHLIGHT_WARM;
}

export function finishOf(colorId: number): ColorFinish {
  return getColor(colorId)?.finish ?? 'solid';
}

export function colorHex(colorId: number): string {
  return getColor(colorId)?.hex ?? FALLBACK_HEX;
}

/** A colour a library part fixes, by its LDraw code, with the look the part gives it. */
export interface FixedColour {
  readonly code: number;
  readonly hex: string;
  readonly finish: ColorFinish;
}

/** How a fixed colour is drawn: as the palette's own colour when the app has that code, else as the part gives it. */
export function fixedLook({ code, hex, finish }: FixedColour): { readonly hex: string; readonly finish: ColorFinish } {
  const known = getColor(code);
  return known ? { hex: known.hex, finish: known.finish } : { hex, finish };
}

function makeMaterial(finish: ColorFinish, hex: string): MeshStandardMaterial {
  const look = FINISHES[finish];
  const transparent = look.opacity < 1;
  return new MeshStandardMaterial({
    color: new Color(hex),
    roughness: look.roughness,
    metalness: look.metalness,
    transparent,
    opacity: look.opacity,
    depthWrite: !transparent,
  });
}

/** Makes a material stamp the outline stencil wherever it draws. */
function marksOutline<T extends Material>(material: T): T {
  material.stencilWrite = true;
  material.stencilRef = OUTLINE_STENCIL;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilZPass = ReplaceStencilOp;
  return material;
}

/** Shares one material per colour and use, so draw calls batch well and nothing leaks. */
export class MaterialLibrary {
  private readonly cache = new Map<string, MeshStandardMaterial>();
  private readonly outlines = new Map<string, MeshBasicMaterial>();

  private cached(key: string, create: () => MeshStandardMaterial): MeshStandardMaterial {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const material = create();
    this.cache.set(key, material);
    return material;
  }

  /** White-based material for instanced meshes; each instance supplies its colour. */
  batch(finish: ColorFinish): MeshStandardMaterial {
    return this.cached(`batch:${finish}`, () => makeMaterial(finish, '#ffffff'));
  }

  /** batch() for bricks that get an outline: it also marks where they are drawn. */
  batchMarked(finish: ColorFinish): MeshStandardMaterial {
    return this.cached(`batch-marked:${finish}`, () => marksOutline(makeMaterial(finish, '#ffffff')));
  }

  /** Instanced counterpart of selected(): a faint warm glow over each brick's own colour, outlined. */
  batchSelected(finish: ColorFinish): MeshStandardMaterial {
    return this.cached(`batch-selected:${finish}`, () => {
      const material = marksOutline(makeMaterial(finish, '#ffffff'));
      material.emissive = new Color(SELECTION_TINT);
      material.emissiveIntensity = 0.12;
      return material;
    });
  }

  /**
   * Instanced build preview. Valid previews take each instance's colour;
   * invalid ones are red, so their instances are drawn white.
   */
  batchGhost(valid: boolean): MeshStandardMaterial {
    return this.cached(`batch-ghost:${valid}`, () => {
      const material = makeMaterial('solid', valid ? '#ffffff' : INVALID_TINT);
      material.transparent = true;
      material.opacity = valid ? 0.72 : 0.5;
      material.depthWrite = false;
      material.emissive = new Color(valid ? '#000000' : INVALID_TINT);
      material.emissiveIntensity = valid ? 0 : 0.35;
      return material;
    });
  }

  solid(colorId: number): MeshStandardMaterial {
    return this.cached(`solid:${colorId}`, () => makeMaterial(finishOf(colorId), colorHex(colorId)));
  }

  /** For a colour a library part fixes, in single meshes such as thumbnails and exports. */
  fixed(colour: FixedColour): MeshStandardMaterial {
    const { hex, finish } = fixedLook(colour);
    return this.cached(`fixed:${hex}:${finish}`, () => makeMaterial(finish, hex));
  }

  selected(colorId: number): MeshStandardMaterial {
    return this.cached(`selected:${colorId}`, () => {
      const material = makeMaterial(finishOf(colorId), colorHex(colorId));
      material.emissive = new Color(SELECTION_TINT);
      material.emissiveIntensity = 0.12;
      return material;
    });
  }

  /**
   * Back faces pushed out along their normals: drawn behind a mesh this
   * leaves a crisp silhouette outline that keeps the brick's own colour intact.
   * The stencil keeps it off the outlined bricks themselves, where detailed
   * meshes (studs, holes, hinges) would otherwise show bits of the hull.
   * Marked transparent only to be drawn after transparent bricks; it is opaque.
   * The width is a uniform, so every outline shares one shader program;
   * 'contrast' outlines are white for instances to colour individually.
   */
  outline(tone: OutlineTone, width = OUTLINE_WIDTH): MeshBasicMaterial {
    const key = `outline:${tone}:${width.toFixed(4)}`;
    const existing = this.outlines.get(key);
    if (existing) return existing;
    const material = new MeshBasicMaterial({
      color: OUTLINE_COLORS[tone],
      side: BackSide,
      transparent: true,
      stencilWrite: true,
      stencilRef: OUTLINE_STENCIL,
      stencilFunc: NotEqualStencilFunc,
    });
    const thickness = { value: width };
    material.onBeforeCompile = (shader) => {
      shader.uniforms['outlineWidth'] = thickness;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * outlineWidth;');
    };
    material.customProgramCacheKey = () => 'brickbench-outline';
    this.outlines.set(key, material);
    return material;
  }

  ghost(colorId: number, valid: boolean): MeshStandardMaterial {
    return this.cached(`ghost:${colorId}:${valid}`, () => {
      const material = makeMaterial('solid', valid ? colorHex(colorId) : INVALID_TINT);
      material.transparent = true;
      material.opacity = valid ? 0.72 : 0.5;
      material.depthWrite = false;
      material.emissive = new Color(valid ? colorHex(colorId) : INVALID_TINT);
      material.emissiveIntensity = valid ? 0.18 : 0.35;
      return material;
    });
  }

  dispose(): void {
    for (const material of [...this.cache.values(), ...this.outlines.values()]) material.dispose();
    this.cache.clear();
    this.outlines.clear();
  }
}
