import { castsNoOcclusion } from './occlusionMark';
import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
} from 'three';
import type { ColorFinish } from '../core/colors';
import type { Vec3 } from '../core/grid';
import { brickOrigin, brickTurn } from '../core/model/geometry';
import { turnOf, type Turn } from '../core/orientation';
import type { StudInstance } from '../core/model/studs';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import type { GeometryCache } from './geometryCache';
import {
  OUTLINE_RENDER_ORDER,
  OUTLINE_WIDTH,
  colorHex,
  finishOf,
  fixedLook,
  highlightFor,
  type MaterialLibrary,
  type OutlineTone,
} from './materials';

const WHITE = new Color('#ffffff');

/** World matrix for something built around `at`, turned by a rotation. */
export function orientedMatrix(at: Vec3, turn: Turn, target = new Matrix4()): Matrix4 {
  const [a, b, c, d, e, f, g, h, i] = turn;
  return target.set(a, b, c, at.x, d, e, f, at.y, g, h, i, at.z, 0, 0, 0, 1);
}

/** World matrix for a brick mesh built around its bottom-centre. */
export function brickMatrix(brick: Brick, lookup: PartLookup, target = new Matrix4()): Matrix4 {
  return orientedMatrix(brickOrigin(brick, lookup), brickTurn(brick), target);
}

function capacityFor(count: number): number {
  return Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(count, 1))));
}

/**
 * How a batch is drawn: resting bricks, outlined new parts (instructions), a
 * highlighted selection (red outline when a drag can't land), or a
 * translucent build preview.
 */
export type BatchLook = 'resting' | 'highlight' | 'selected' | 'invalid' | 'ghost' | 'ghost-invalid';

interface LookStyle {
  readonly material: (materials: MaterialLibrary, finish: ColorFinish) => Material;
  readonly outline: OutlineTone | null;
  readonly shadows: boolean;
  /** Instances drawn white so the material's own colour shows. */
  readonly plainColor: boolean;
  readonly renderOrder: number;
}

const LOOKS: Readonly<Record<BatchLook, LookStyle>> = {
  resting: { material: (m, f) => m.batch(f), outline: null, shadows: true, plainColor: false, renderOrder: 0 },
  highlight: { material: (m, f) => m.batchMarked(f), outline: 'contrast', shadows: false, plainColor: false, renderOrder: 0 },
  selected: { material: (m, f) => m.batchSelected(f), outline: 'selection', shadows: true, plainColor: false, renderOrder: 0 },
  invalid: { material: (m, f) => m.batchSelected(f), outline: 'invalid', shadows: true, plainColor: false, renderOrder: 0 },
  ghost: { material: (m) => m.batchGhost(true), outline: null, shadows: false, plainColor: false, renderOrder: 2 },
  'ghost-invalid': { material: (m) => m.batchGhost(false), outline: null, shadows: false, plainColor: true, renderOrder: 2 },
};

interface BatchEntry {
  readonly mesh: InstancedMesh;
  readonly finish: ColorFinish;
}

/**
 * Draws bricks with one instanced mesh per part and finish, plus one
 * instanced mesh of studs per finish, one per colour a library part fixes
 * (a wheel's tyre), and one outline mesh per part when the look calls for
 * it: a few dozen draw calls however many bricks there are.
 */
export class BrickBatches {
  readonly group = new Group();
  private readonly bodies = new Map<string, BatchEntry>();
  private readonly studs = new Map<string, BatchEntry>();
  private readonly layers = new Map<string, BatchEntry>();
  private readonly outlines = new Map<string, InstancedMesh>();
  private readonly colors = new Map<number, Color>();
  private readonly fixedColors = new Map<string, Color>();
  private readonly highlights = new Map<number, Color>();
  private readonly scratch = new Matrix4();
  /** What was drawn last, to draw again once library meshes arrive. */
  private drawn: { readonly bricks: readonly Brick[]; readonly studs: readonly StudInstance[] } = { bricks: [], studs: [] };

  constructor(
    private readonly geometries: GeometryCache,
    private readonly materials: MaterialLibrary,
    private readonly lookup: PartLookup,
    private look: BatchLook = 'resting',
    /** Outline thickness in world units. */
    private outlineWidth = OUTLINE_WIDTH,
  ) {}

  /** Changes the outline thickness, e.g. to keep it a steady number of pixels in a picture. */
  setOutlineWidth(width: number): void {
    if (width === this.outlineWidth) return;
    this.outlineWidth = width;
    const tone = LOOKS[this.look].outline;
    if (!tone) return;
    for (const outline of this.outlines.values()) outline.material = this.materials.outline(tone, width);
  }

  /** Switches how existing instances are drawn; colours follow on the next update(). */
  setLook(look: BatchLook): void {
    if (look === this.look) return;
    this.look = look;
    const style = LOOKS[look];
    for (const entry of [...this.bodies.values(), ...this.studs.values(), ...this.layers.values()]) this.styleMesh(entry.mesh, entry.finish, style);
    for (const outline of this.outlines.values()) {
      outline.visible = style.outline !== null;
      if (style.outline) outline.material = this.materials.outline(style.outline, this.outlineWidth);
    }
    // outlines dropped meanwhile, say by a redraw while a picture was taken in another look, come back
    if (style.outline) this.updateOutlines(this.drawn.bricks);
  }

  update(bricks: readonly Brick[], studs: readonly StudInstance[]): void {
    this.drawn = { bricks, studs };
    const byKey = groupBy(bricks, (b) => `${b.partId}|${finishOf(b.colorId)}`);
    for (const [key, list] of byKey) {
      const [partId = '', finish = 'solid'] = key.split('|');
      const mesh = this.ensure(this.bodies, key, list.length, this.geometries.body(partId), finish as ColorFinish);
      list.forEach((brick, i) => {
        mesh.setMatrixAt(i, brickMatrix(brick, this.lookup, this.scratch));
        mesh.setColorAt(i, this.color(brick.colorId));
      });
      finishBatch(mesh, list.length);
    }
    this.prune(this.bodies, new Set(byKey.keys()));

    const studsByFinish = groupBy(studs, (s) => finishOf(s.colorId));
    for (const [finish, list] of studsByFinish) {
      const mesh = this.ensure(this.studs, finish, list.length, this.geometries.stud(), finish as ColorFinish);
      list.forEach((stud, i) => {
        mesh.setMatrixAt(i, orientedMatrix(stud, stud.m ?? turnOf(stud.r), this.scratch));
        mesh.setColorAt(i, this.color(stud.colorId));
      });
      finishBatch(mesh, list.length);
    }
    this.prune(this.studs, new Set(studsByFinish.keys()));

    this.updateLayers(bricks);
    this.updateOutlines(bricks);
  }

  /** The colours library parts fix, each drawn over every brick of its part, whatever colour the brick is. */
  private updateLayers(bricks: readonly Brick[]): void {
    const keep = new Set<string>();
    for (const [partId, list] of groupBy(bricks, (b) => b.partId)) {
      this.geometries.layers(partId).forEach((layer, n) => {
        const { hex, finish } = fixedLook(layer);
        const key = `${partId}|${n}|${finish}`;
        keep.add(key);
        const mesh = this.ensure(this.layers, key, list.length, layer.geometry, finish);
        const color = this.fixedColor(hex);
        list.forEach((brick, i) => {
          mesh.setMatrixAt(i, brickMatrix(brick, this.lookup, this.scratch));
          mesh.setColorAt(i, color);
        });
        finishBatch(mesh, list.length);
      });
    }
    this.prune(this.layers, keep);
  }

  private updateOutlines(bricks: readonly Brick[]): void {
    const style = LOOKS[this.look];
    const byPart = style.outline ? groupBy(bricks, (b) => b.partId) : new Map<string, Brick[]>();
    for (const [partId, list] of byPart) {
      let mesh = this.outlines.get(partId);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) this.dropOutline(partId, mesh);
        const material = this.materials.outline(style.outline ?? 'selection', this.outlineWidth);
        mesh = new InstancedMesh(this.geometries.outline(partId), material, capacityFor(list.length));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.renderOrder = OUTLINE_RENDER_ORDER;
        castsNoOcclusion(mesh);
        this.outlines.set(partId, mesh);
        this.group.add(mesh);
      }
      mesh.visible = true;
      const contrast = style.outline === 'contrast';
      list.forEach((brick, i) => {
        mesh.setMatrixAt(i, brickMatrix(brick, this.lookup, this.scratch));
        if (contrast || mesh.instanceColor) mesh.setColorAt(i, contrast ? this.highlight(brick.colorId) : WHITE);
      });
      finishBatch(mesh, list.length);
    }
    for (const [partId, mesh] of this.outlines) if (!byPart.has(partId)) this.dropOutline(partId, mesh);
  }

  private highlight(colorId: number): Color {
    let color = this.highlights.get(colorId);
    if (!color) {
      color = new Color(highlightFor(colorId));
      this.highlights.set(colorId, color);
    }
    return color;
  }

  private color(colorId: number): Color {
    if (LOOKS[this.look].plainColor) return WHITE;
    let color = this.colors.get(colorId);
    if (!color) {
      color = new Color(colorHex(colorId));
      this.colors.set(colorId, color);
    }
    return color;
  }

  private fixedColor(hex: string): Color {
    if (LOOKS[this.look].plainColor) return WHITE;
    let color = this.fixedColors.get(hex);
    if (!color) {
      color = new Color(hex);
      this.fixedColors.set(hex, color);
    }
    return color;
  }

  private styleMesh(mesh: InstancedMesh, finish: ColorFinish, style: LookStyle): void {
    mesh.material = style.material(this.materials, finish);
    mesh.castShadow = style.shadows && finish !== 'transparent';
    mesh.receiveShadow = style.shadows;
    mesh.renderOrder = finish === 'transparent' ? Math.max(1, style.renderOrder) : style.renderOrder;
  }

  private ensure(map: Map<string, BatchEntry>, key: string, count: number, geometry: BufferGeometry, finish: ColorFinish): InstancedMesh {
    const existing = map.get(key);
    if (existing && existing.mesh.instanceMatrix.count >= count) return existing.mesh;
    if (existing) this.remove(map, key, existing.mesh);

    const mesh = new InstancedMesh(geometry, this.materials.batch(finish), capacityFor(count));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.styleMesh(mesh, finish, LOOKS[this.look]);
    map.set(key, { mesh, finish });
    this.group.add(mesh);
    return mesh;
  }

  private prune(map: Map<string, BatchEntry>, keep: ReadonlySet<string>): void {
    for (const [key, entry] of map) if (!keep.has(key)) this.remove(map, key, entry.mesh);
  }

  private remove(map: Map<string, BatchEntry>, key: string, mesh: InstancedMesh): void {
    this.group.remove(mesh);
    mesh.dispose();
    map.delete(key);
  }

  private dropOutline(partId: string, mesh: InstancedMesh): void {
    this.group.remove(mesh);
    mesh.dispose();
    this.outlines.delete(partId);
  }

  /**
   * Draws the last bricks again after library meshes replaced their
   * placeholders: their bounds changed, and the colours they fix need
   * batches of their own.
   */
  refreshParts(): void {
    this.update(this.drawn.bricks, this.drawn.studs);
  }

  /** Removes every instance, keeping the batch usable. */
  clear(): void {
    this.update([], []);
  }

  dispose(): void {
    this.clear();
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function finishBatch(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}
