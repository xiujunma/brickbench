import { describe, expect, it, vi } from 'bun:test';
import { toPartDef } from '../core/ldraw/catalogIndex';
import type { PartMesh } from '../core/ldraw/format';
import { getPart } from '../core/parts/catalog';
import type { PartLookup } from '../core/parts/types';
import { GeometryCache } from './geometryCache';
import type { MeshSource } from './meshStore';

const LIBRARY_BRICK = toPartDef({ id: '3001', name: 'Brick 2 × 4', category: 'Brick', w: 4, d: 2, h: 3, origin: [0, 1.2, 0], snug: true });
const lookup: PartLookup = (id) => (id === LIBRARY_BRICK.id ? LIBRARY_BRICK : getPart(id));

/** Two triangles forming a hard 90° edge along x = 0. */
const FOLD: PartMesh = {
  positions: new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, -1, 0, 0, -1, 0, 0, -1, 0, 0]),
  indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
};

class FakeSource implements MeshSource {
  readonly meshes = new Map<string, PartMesh>();
  readonly requested: string[] = [];
  private readonly listeners = new Set<(partId: string, mesh: PartMesh) => void>();
  private readonly retryListeners = new Set<() => void>();

  request(partId: string): PartMesh | null {
    this.requested.push(partId);
    return this.meshes.get(partId) ?? null;
  }

  load(partId: string): Promise<PartMesh> {
    const mesh = this.meshes.get(partId);
    return mesh ? Promise.resolve(mesh) : Promise.reject(new Error('HTTP 404'));
  }

  subscribe(listener: (partId: string, mesh: PartMesh) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRetry(listener: () => void): () => void {
    this.retryListeners.add(listener);
    return () => this.retryListeners.delete(listener);
  }

  retry(): void {
    for (const listener of this.retryListeners) listener();
  }

  arrive(partId: string, mesh: PartMesh): void {
    this.meshes.set(partId, mesh);
    for (const listener of this.listeners) listener(partId, mesh);
  }
}

describe('GeometryCache with library parts', () => {
  it('draws a box of the part’s size until its mesh arrives, then fills that same geometry', () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    const changed = vi.fn();
    cache.onChange(changed);

    const body = cache.body('ldraw:3001');
    expect(cache.isPlaceholder('ldraw:3001')).toBe(true);
    expect(source.requested).toEqual(['ldraw:3001']);
    body.computeBoundingBox();
    expect(body.boundingBox?.max.x).toBeCloseTo(2, 1);
    expect(body.boundingBox?.max.y).toBeCloseTo(1.2, 2);

    source.arrive('ldraw:3001', FOLD);
    expect(cache.body('ldraw:3001')).toBe(body);
    expect(body.getAttribute('position').count).toBe(6);
    expect(body.boundingSphere).not.toBeNull();
    expect(cache.isPlaceholder('ldraw:3001')).toBe(false);
    expect(changed).toHaveBeenCalledWith('ldraw:3001');
  });

  it('uses the library mesh, studs included, for whole-part pictures', () => {
    const source = new FakeSource();
    source.meshes.set('ldraw:3001', FOLD);
    const cache = new GeometryCache(lookup, source);
    expect(cache.part('ldraw:3001')).toBe(cache.body('ldraw:3001'));
    expect(cache.isPlaceholder('ldraw:3001')).toBe(false);
  });

  it('outlines library meshes with normals averaged across hard edges', () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    const outline = cache.outline('ldraw:3001');
    source.arrive('ldraw:3001', FOLD);
    const normals = outline.getAttribute('normal');
    // the shared corner at the origin points between both faces
    expect(normals.getX(0)).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(normals.getZ(0)).toBeCloseTo(-Math.SQRT1_2, 5);
    // a corner on one face only keeps that face's normal
    expect(normals.getZ(2)).toBeCloseTo(-1, 5);
    expect(outline.getAttribute('position')).not.toBe(cache.body('ldraw:3001').getAttribute('position'));
  });

  it('keeps built-in parts as before: separate body and full part, outline from the body', () => {
    const cache = new GeometryCache(lookup, new FakeSource());
    expect(cache.part('brick-2x4')).not.toBe(cache.body('brick-2x4'));
    expect(cache.outline('brick-2x4')).toBe(cache.body('brick-2x4'));
  });

  it('ignores meshes for parts it is not drawing', () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    const changed = vi.fn();
    cache.onChange(changed);
    source.arrive('ldraw:3001', FOLD);
    expect(changed).not.toHaveBeenCalled();
    expect(cache.isPlaceholder('ldraw:3001')).toBe(false);
  });

  it('preloads meshes for exports and reports the parts that failed', async () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    const placeholder = cache.body('ldraw:3001');
    source.meshes.set('ldraw:3001', FOLD);
    await expect(cache.preload(['ldraw:3001', 'brick-2x4', 'ldraw:3001'])).resolves.toEqual([]);
    expect(cache.body('ldraw:3001')).toBe(placeholder);
    expect(placeholder.getAttribute('position').count).toBe(6);

    const { w, d, h } = LIBRARY_BRICK;
    const missing = toPartDef({ id: '9999', name: 'Gone', category: 'Brick', w, d, h, origin: [0, 0, 0], snug: true });
    const withMissing = new GeometryCache((id) => (id === missing.id ? missing : lookup(id)), source);
    await expect(withMissing.preload(['ldraw:9999'])).resolves.toEqual(['ldraw:9999']);
  });

  it('asks again for parts still drawn as boxes when failures may be retried', () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    cache.body('ldraw:3001');
    cache.body('brick-2x4');
    source.retry();
    expect(source.requested).toEqual(['ldraw:3001', 'ldraw:3001']);
    source.arrive('ldraw:3001', FOLD);
    source.retry();
    expect(source.requested).toHaveLength(2);
  });

  it('frees a part on release and stops listening on dispose', () => {
    const source = new FakeSource();
    const cache = new GeometryCache(lookup, source);
    const body = cache.body('ldraw:3001');
    const disposed = vi.fn();
    body.addEventListener('dispose', disposed);
    cache.release('ldraw:3001');
    expect(disposed).toHaveBeenCalled();
    expect(cache.body('ldraw:3001')).not.toBe(body);

    const changed = vi.fn();
    cache.onChange(changed);
    cache.dispose();
    source.arrive('ldraw:3001', FOLD);
    expect(changed).not.toHaveBeenCalled();
  });
});
