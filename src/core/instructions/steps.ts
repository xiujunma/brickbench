import { brickOrigin } from '../model/geometry';
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';

/**
 * How bricks are split into instruction steps: bottom layer first (always
 * buildable), or the order the bricks were placed in.
 */
export type StepOrder = 'layers' | 'build-order';

export interface StepOptions {
  readonly order: StepOrder;
  /** Most bricks one step may add. */
  readonly partsPerStep: number;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = { order: 'layers', partsPerStep: 6 };

export interface BuildStep {
  /** Bricks this step adds to the model. */
  readonly added: readonly Brick[];
}

interface Placed {
  readonly brick: Brick;
  readonly x: number;
  readonly z: number;
}

/** Side of the square buckets used to find nearby bricks, in studs. */
const BUCKET = 4;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Bricks of one layer bucketed by position, so "closest remaining brick"
 * looks at a few nearby buckets instead of the whole layer.
 */
class NearbyIndex {
  private readonly buckets = new Map<string, number[]>();
  private readonly minBx: number;
  private readonly maxBx: number;
  private readonly minBz: number;
  private readonly maxBz: number;

  constructor(private readonly items: readonly Placed[]) {
    let minBx = Infinity, maxBx = -Infinity, minBz = Infinity, maxBz = -Infinity;
    items.forEach((item, i) => {
      const bx = Math.floor(item.x / BUCKET);
      const bz = Math.floor(item.z / BUCKET);
      const key = `${bx},${bz}`;
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
      minBx = Math.min(minBx, bx);
      maxBx = Math.max(maxBx, bx);
      minBz = Math.min(minBz, bz);
      maxBz = Math.max(maxBz, bz);
    });
    this.minBx = minBx;
    this.maxBx = maxBx;
    this.minBz = minBz;
    this.maxBz = maxBz;
  }

  remove(i: number): void {
    const item = this.items[i];
    if (!item) return;
    const key = `${Math.floor(item.x / BUCKET)},${Math.floor(item.z / BUCKET)}`;
    const list = this.buckets.get(key);
    const at = list?.indexOf(i) ?? -1;
    if (!list || at < 0) return;
    list.splice(at, 1);
    if (list.length === 0) this.buckets.delete(key);
  }

  /** Closest remaining brick to (x, z); ties go to the earliest placed. */
  nearest(x: number, z: number): number | null {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    const maxRing = Math.max(bx - this.minBx, this.maxBx - bx, bz - this.minBz, this.maxBz - bz);
    let best = -1;
    let bestDistance = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      // anything in this ring is at least (ring - 1) buckets away
      const reach = Math.max(0, (ring - 1) * BUCKET);
      if (best >= 0 && reach * reach > bestDistance) break;
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          for (const i of this.buckets.get(`${bx + dx},${bz + dz}`) ?? []) {
            const item = this.items[i] as Placed;
            const distance = (item.x - x) ** 2 + (item.z - z) ** 2;
            if (distance < bestDistance || (distance === bestDistance && i < best)) {
              best = i;
              bestDistance = distance;
            }
          }
        }
      }
    }
    return best >= 0 ? best : null;
  }
}

/**
 * Splits one layer into compact groups: each group starts from the earliest
 * placed brick left over and grows with whichever brick is closest to it, so
 * a step's parts sit together and are easy to find a home for.
 */
function nearbyGroups(layer: readonly Placed[], size: number): Brick[][] {
  const index = new NearbyIndex(layer);
  const used = new Array<boolean>(layer.length).fill(false);
  const groups: Brick[][] = [];
  let next = 0;
  const take = (i: number): Placed => {
    used[i] = true;
    index.remove(i);
    return layer[i] as Placed;
  };

  while (next < layer.length) {
    if (used[next]) {
      next += 1;
      continue;
    }
    const group: Placed[] = [take(next)];
    let sumX = group[0]?.x ?? 0;
    let sumZ = group[0]?.z ?? 0;
    while (group.length < size) {
      const closest = index.nearest(sumX / group.length, sumZ / group.length);
      if (closest === null) break;
      const placed = take(closest);
      group.push(placed);
      sumX += placed.x;
      sumZ += placed.z;
    }
    groups.push(group.map((p) => p.brick));
  }
  return groups;
}

function layeredSteps(bricks: readonly Brick[], lookup: PartLookup, size: number): Brick[][] {
  const layers = new Map<number, Placed[]>();
  for (const brick of bricks) {
    const centre = brickOrigin(brick, lookup);
    const layer = layers.get(brick.y) ?? [];
    layer.push({ brick, x: centre.x, z: centre.z });
    layers.set(brick.y, layer);
  }

  const steps: Brick[][] = [];
  let current: Brick[] = [];
  for (const y of [...layers.keys()].sort((a, b) => a - b)) {
    for (const group of nearbyGroups(layers.get(y) ?? [], size)) {
      // small groups from neighbouring layers share a step when they fit
      if (current.length > 0 && current.length + group.length > size) {
        steps.push(current);
        current = [];
      }
      current = [...current, ...group];
    }
  }
  if (current.length > 0) steps.push(current);
  return steps;
}

/** Plans the steps of a building booklet. Every brick appears in exactly one step. */
export function planSteps(bricks: readonly Brick[], lookup: PartLookup, options: StepOptions): BuildStep[] {
  const size = Math.max(1, Math.floor(options.partsPerStep));
  const groups = options.order === 'build-order' ? chunk(bricks, size) : layeredSteps(bricks, lookup, size);
  return groups.map((added) => ({ added }));
}
