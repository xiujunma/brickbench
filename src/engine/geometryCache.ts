import { BufferGeometry } from 'three';
import { MAIN_COLOUR, meshLayers, type MeshLayer, type PartMesh } from '../core/ldraw/format';
import { requirePart } from '../core/model/geometry';
import type { PartDef, PartLookup } from '../core/parts/types';
import { fillGeometry, fillOutlineGeometry, geometryFromMesh, outlineGeometryFor, runGeometry } from './geometry/meshGeometry';
import {
  STUD_DETAIL,
  STUD_DETAIL_LOW,
  buildBodyGeometry,
  buildPartGeometry,
  buildStudGeometry,
} from './geometry/partGeometry';
import type { MeshSource } from './meshStore';

/** A colour a library part fixes, such as a wheel's black tyre, and the triangles drawn in it. */
export interface PartLayer extends Pick<MeshLayer, 'code' | 'hex' | 'finish'> {
  readonly geometry: BufferGeometry;
}

const NO_LAYERS: readonly PartLayer[] = [];
const NOTHING = { start: 0, count: 0 };

/**
 * Builds each part mesh once and shares it between every brick using it.
 * Library parts show a plain box until their mesh arrives; the box's
 * geometry is then filled in place, so whatever draws it updates by itself.
 * A library part's body holds the triangles in the brick's own colour; the
 * colours it fixes come as layers, drawn alongside.
 */
export class GeometryCache {
  private readonly bodies = new Map<string, BufferGeometry>();
  private readonly full = new Map<string, BufferGeometry>();
  private readonly outlines = new Map<string, BufferGeometry>();
  private readonly studs = new Map<'normal' | 'low', BufferGeometry>();
  /** The library meshes in use, for their layers and outlines. */
  private readonly meshesInUse = new Map<string, PartMesh>();
  private readonly layerSets = new Map<string, readonly PartLayer[]>();
  /** Library parts still drawn as placeholder boxes. */
  private readonly placeholders = new Set<string>();
  private readonly listeners = new Set<(partId: string) => void>();
  private readonly unsubscribe: readonly (() => void)[];

  constructor(
    private readonly lookup: PartLookup,
    private readonly meshes: MeshSource | null = null,
  ) {
    this.unsubscribe = meshes
      ? [
          // only fill in parts this cache is already drawing; other loads are none of its business
          meshes.subscribe((partId, mesh) => this.adopt(partId, mesh, false)),
          // ask again for every part still drawn as a box
          meshes.onRetry(() => {
            for (const partId of this.placeholders) meshes.request(partId);
          }),
        ]
      : [];
  }

  body(partId: string): BufferGeometry {
    let geometry = this.bodies.get(partId);
    if (!geometry) {
      const part = requirePart(this.lookup, partId);
      geometry = part.shape.kind === 'mesh' ? this.libraryGeometry(part) : buildBodyGeometry(part);
      this.bodies.set(partId, geometry);
    }
    return geometry;
  }

  /** Body with studs, for single meshes, previews and exports. */
  part(partId: string): BufferGeometry {
    const part = requirePart(this.lookup, partId);
    // library meshes carry their own studs
    if (part.shape.kind === 'mesh') return this.body(partId);
    let geometry = this.full.get(partId);
    if (!geometry) {
      geometry = buildPartGeometry(part);
      this.full.set(partId, geometry);
    }
    return geometry;
  }

  /** The colours a library part fixes, each with its triangles; none for built-in parts or while a mesh loads. */
  layers(partId: string): readonly PartLayer[] {
    this.body(partId);
    return this.layerSets.get(partId) ?? NO_LAYERS;
  }

  /** What outlines are drawn from: the whole part, with normals that keep a pushed-out hull closed. */
  outline(partId: string): BufferGeometry {
    const part = requirePart(this.lookup, partId);
    if (part.shape.kind !== 'mesh') return this.body(partId);
    let geometry = this.outlines.get(partId);
    if (!geometry) {
      geometry = outlineGeometryFor(this.whole(partId));
      this.outlines.set(partId, geometry);
    }
    return geometry;
  }

  /** A library part's every triangle, whatever its colour, or its placeholder box. */
  private whole(partId: string): BufferGeometry {
    const body = this.body(partId);
    const mesh = this.meshesInUse.get(partId);
    return mesh ? geometryFromMesh(mesh) : body;
  }

  stud(detail: 'normal' | 'low' = 'normal'): BufferGeometry {
    let geometry = this.studs.get(detail);
    if (!geometry) {
      geometry = buildStudGeometry(detail === 'low' ? STUD_DETAIL_LOW : STUD_DETAIL);
      this.studs.set(detail, geometry);
    }
    return geometry;
  }

  /** Whether a library part is still drawn as a stand-in box. */
  isPlaceholder(partId: string): boolean {
    return this.placeholders.has(partId);
  }

  /** Calls back after a library mesh replaced its placeholder, so views can redraw. */
  onChange(listener: (partId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Loads library meshes for these parts up front, for pictures and exports
   * that must not show placeholders. Resolves with the parts that failed.
   */
  async preload(partIds: Iterable<string>): Promise<string[]> {
    const meshes = this.meshes;
    const ids = [...new Set(partIds)].filter((id) => this.lookup(id)?.shape.kind === 'mesh');
    if (!meshes) return ids;
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        this.adopt(id, await meshes.load(id), true);
      }),
    );
    return ids.filter((_, i) => results[i]?.status === 'rejected');
  }

  /** Frees one part's geometries, e.g. once a thumbnail of a library part is drawn. */
  release(partId: string): void {
    for (const map of [this.bodies, this.full, this.outlines]) {
      map.get(partId)?.dispose();
      map.delete(partId);
    }
    for (const layer of this.layerSets.get(partId) ?? NO_LAYERS) layer.geometry.dispose();
    this.layerSets.delete(partId);
    this.meshesInUse.delete(partId);
    this.placeholders.delete(partId);
  }

  private libraryGeometry(part: PartDef): BufferGeometry {
    const mesh = this.meshes?.request(part.id) ?? null;
    if (mesh) return this.useMesh(part.id, mesh, new BufferGeometry());
    this.placeholders.add(part.id);
    return buildBodyGeometry(part);
  }

  /** Fills a library part's body with the triangles in the brick's colour, and makes a layer of each colour it fixes. */
  private useMesh(partId: string, mesh: PartMesh, body: BufferGeometry): BufferGeometry {
    const layers = meshLayers(mesh);
    fillGeometry(body, mesh, layers.find((layer) => layer.code === MAIN_COLOUR) ?? NOTHING);
    for (const layer of this.layerSets.get(partId) ?? NO_LAYERS) layer.geometry.dispose();
    this.layerSets.set(
      partId,
      layers.filter((layer) => layer.code !== MAIN_COLOUR).map(({ code, hex, finish, start, count }) => ({ code, hex, finish, geometry: runGeometry(body, mesh, { start, count }) })),
    );
    this.meshesInUse.set(partId, mesh);
    return body;
  }

  private adopt(partId: string, mesh: PartMesh, create: boolean): void {
    const body = this.bodies.get(partId);
    if (!body) {
      if (create) this.bodies.set(partId, this.useMesh(partId, mesh, new BufferGeometry()));
      return;
    }
    if (!this.placeholders.has(partId)) return;
    this.placeholders.delete(partId);
    this.useMesh(partId, mesh, body);
    const outline = this.outlines.get(partId);
    if (outline) fillOutlineGeometry(outline, geometryFromMesh(mesh));
    for (const listener of this.listeners) listener(partId);
  }

  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.listeners.clear();
    for (const map of [this.bodies, this.full, this.outlines, this.studs] as const) {
      for (const geometry of map.values()) geometry.dispose();
      map.clear();
    }
    for (const layers of this.layerSets.values()) for (const layer of layers) layer.geometry.dispose();
    this.layerSets.clear();
    this.meshesInUse.clear();
    this.placeholders.clear();
  }
}
