import { AlwaysStencilFunc, NotEqualStencilFunc, ReplaceStencilOp } from 'three';
import { describe, expect, it } from 'bun:test';
import { MaterialLibrary, OUTLINE_STENCIL, SELECTION_TINT, colorHex, finishOf, highlightFor } from './materials';

const BLUE = '#1f6feb';

describe('highlightFor', () => {
  it('outlines warm bricks in blue, where orange would vanish', () => {
    for (const warm of [4, 320, 25, 14, 19, 70, 353]) expect(highlightFor(warm), String(warm)).toBe(BLUE);
  });

  it('outlines everything else in orange', () => {
    for (const other of [15, 0, 71, 1, 2, 10, 26, 47]) expect(highlightFor(other), String(other)).toBe(SELECTION_TINT);
  });
});

describe('outline stencil', () => {
  const materials = new MaterialLibrary();

  it('has outlined bricks mark where they are drawn, and resting bricks not', () => {
    for (const marked of [materials.batchMarked('solid'), materials.batchSelected('transparent')]) {
      expect(marked).toMatchObject({ stencilWrite: true, stencilRef: OUTLINE_STENCIL, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
    }
    expect(materials.batch('solid').stencilWrite).toBe(false);
    expect(materials.batchMarked('solid')).not.toBe(materials.batch('solid'));
  });

  it('draws outlines only off the marked bricks, after every brick', () => {
    const outline = materials.outline('selection');
    expect(outline).toMatchObject({ stencilWrite: true, stencilRef: OUTLINE_STENCIL, stencilFunc: NotEqualStencilFunc, transparent: true, opacity: 1 });
  });
});

describe('material library', () => {
  it('shares one material per use and finish', () => {
    const materials = new MaterialLibrary();
    expect(materials.batch('solid')).toBe(materials.batch('solid'));
    expect(materials.batch('solid')).not.toBe(materials.batch('chrome'));
    expect(materials.solid(4)).toBe(materials.solid(4));
    const glass = materials.batch('transparent');
    expect(glass).toMatchObject({ transparent: true, depthWrite: false });
    expect(glass.opacity).toBeLessThan(1);
  });

  it('colours single parts, selections and previews', () => {
    const materials = new MaterialLibrary();
    expect(`#${materials.solid(4).color.getHexString()}`).toBe(colorHex(4).toLowerCase());
    expect(materials.selected(4).emissiveIntensity).toBeGreaterThan(0);
    expect(materials.batchSelected('solid').emissiveIntensity).toBeGreaterThan(0);
    for (const ghost of [materials.ghost(1, true), materials.ghost(1, false), materials.batchGhost(true), materials.batchGhost(false)]) {
      expect(ghost).toMatchObject({ transparent: true, depthWrite: false });
    }
    // a preview that cannot land is red whatever the brick's colour
    expect(materials.ghost(1, false).color.getHexString()).toBe(materials.ghost(2, false).color.getHexString());
    expect(materials.ghost(1, true).opacity).toBeGreaterThan(materials.ghost(1, false).opacity);
  });

  it('falls back to grey and a solid finish for unknown colours', () => {
    expect(colorHex(999_999)).toBe('#9a9a9a');
    expect(finishOf(999_999)).toBe('solid');
  });

  it('pushes outlines out by a width every outline shares one shader for', () => {
    const materials = new MaterialLibrary();
    const thin = materials.outline('selection', 0.02);
    expect(materials.outline('selection', 0.02)).toBe(thin);
    const thick = materials.outline('selection', 0.08);
    expect(thick).not.toBe(thin);
    expect(thick.customProgramCacheKey()).toBe(thin.customProgramCacheKey());
    const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: '#include <common>\n#include <begin_vertex>' };
    thick.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms['outlineWidth']?.value).toBe(0.08);
    expect(shader.vertexShader).toContain('transformed += normal * outlineWidth;');
  });

  it('disposes everything it made and starts afresh', () => {
    const materials = new MaterialLibrary();
    const batch = materials.batch('solid');
    const outline = materials.outline('invalid');
    let disposed = 0;
    for (const material of [batch, outline]) material.addEventListener('dispose', () => void (disposed += 1));
    materials.dispose();
    expect(disposed).toBe(2);
    expect(materials.batch('solid')).not.toBe(batch);
  });
});
