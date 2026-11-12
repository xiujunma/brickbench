import type { BufferGeometry } from 'three';
import type { PartMesh } from '../core/ldraw/format';
import { requirePart } from '../core/model/geometry';
import type { PartDef, PartLookup } from '../core/parts/types';
import { fillGeometry, fillOutlineGeometry, geometryFromMesh, outlineGeometryFor } from './geometry/meshGeometry';
import {
  STUD_DETAIL,
  STUD_DETAIL_LOW,
  buildBodyGeometry,
  buildPartGeometry,
  buildStudGeometry,
} from './geometry/partGeometry';
import type { MeshSource } from './meshStore';

/**
 * Builds each part mesh once and shares it between every brick using it.
 * Library parts show a plain box until their mesh arrives; the box's
 * geometry is then filled in place, so whatever draws it updates by itself.
 */
export class GeometryCache {
  private readonly bodies = new Map<string, BufferGeometry>();
  private readonly full = new Map<string, BufferGeometry>();
  private readonly outlines = new Map<string, BufferGeometry>();
  private readonly studs = new Map<'normal' | 'low', BufferGeometry>();
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

  /** What outlines are drawn from: the body, with normals that keep a pushed-out hull closed. */
  outline(partId: string): BufferGeometry {
    const part = requirePart(this.lookup, partId);
    if (part.shape.kind !== 'mesh') return this.body(partId);
    let geometry = this.outlines.get(partId);
    if (!geometry) {
      geometry = outlineGeometryFor(this.body(partId));
      this.outlines.set(partId, geometry);
    }
    return geometry;
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
    this.placeholders.delete(partId);
  }

  private libraryGeometry(part: PartDef): BufferGeometry {
    const mesh = this.meshes?.request(part.id) ?? null;
    if (mesh) return geometryFromMesh(mesh);
    this.placeholders.add(part.id);
    return buildBodyGeometry(part);
  }

  private adopt(partId: string, mesh: PartMesh, create: boolean): void {
    const body = this.bodies.get(partId);
    if (!body) {
      if (create) this.bodies.set(partId, geometryFromMesh(mesh));
      return;
    }
    if (!this.placeholders.has(partId)) return;
    this.placeholders.delete(partId);
    fillGeometry(body, mesh);
    const outline = this.outlines.get(partId);
    if (outline) fillOutlineGeometry(outline, body);
    for (const listener of this.listeners) listener(partId);
  }

  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.listeners.clear();
    for (const map of [this.bodies, this.full, this.outlines, this.studs] as const) {
      for (const geometry of map.values()) geometry.dispose();
      map.clear();
    }
    this.placeholders.clear();
  }
}
