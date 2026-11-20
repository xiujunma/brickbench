import { describe, expect, it } from 'bun:test';
import type { Vec3 } from '../grid';
import { DEFAULT_VIEW_DIRECTION, STEEPEST_VIEW, drawableDirection, frameView } from './camera';

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function corners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push({ x, y, z });
  return out;
}

describe('frameView', () => {
  it('frames a box seen straight on, matching the picture shape', () => {
    const frame = frameView({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 2 } }, { x: 0, y: 0, z: -1 }, 2, { margin: 0, minHalfWidth: 0 });
    expect(frame.right.x).toBeCloseTo(1);
    expect(frame.up.y).toBeCloseTo(1);
    expect(frame.halfWidth).toBeCloseTo(1);
    expect(frame.halfHeight).toBeCloseTo(0.5);
    expect(frame.target.x).toBeCloseTo(1);
    expect(frame.target.y).toBeCloseTo(0.5);
  });

  it('keeps every corner inside the frame from any angle', () => {
    const bounds = { min: { x: -6, y: 0, z: -4 }, max: { x: 6, y: 7.2, z: 4 } };
    for (const direction of [DEFAULT_VIEW_DIRECTION, { x: 1, y: -0.3, z: 0.2 }, { x: -0.4, y: -0.9, z: -0.1 }]) {
      const frame = frameView(bounds, direction, 1.3);
      expect(frame.halfWidth / frame.halfHeight).toBeCloseTo(1.3);
      for (const corner of corners(bounds.min, bounds.max)) {
        const offset = sub(corner, frame.target);
        expect(Math.abs(dot(offset, frame.right))).toBeLessThanOrEqual(frame.halfWidth + 1e-9);
        expect(Math.abs(dot(offset, frame.up))).toBeLessThanOrEqual(frame.halfHeight + 1e-9);
      }
    }
  });

  it('never zooms in closer than the minimum width', () => {
    const frame = frameView({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, DEFAULT_VIEW_DIRECTION, 1, { margin: 0, minHalfWidth: 3 });
    expect(frame.halfWidth).toBeCloseTo(3);
  });

  it('tilts a view looking down too steeply up to the steepest there is, keeping its heading', () => {
    const steep = drawableDirection({ x: 0.03, y: -2, z: -0.04 });
    expect(steep?.y).toBeCloseTo(-STEEPEST_VIEW);
    expect(Math.hypot(steep?.x ?? 0, steep?.y ?? 0, steep?.z ?? 0)).toBeCloseTo(1);
    // the same heading: three parts across to four parts back
    expect((steep?.x ?? 0) / (steep?.z ?? 1)).toBeCloseTo(-0.75);
    expect(frameView({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, { x: 0.03, y: -2, z: -0.04 }, 1).forward.y).toBeCloseTo(-STEEPEST_VIEW);
    // a view no steeper than that stays as it is, at unit length
    const level = drawableDirection({ x: 0, y: -1, z: -1 });
    expect(level?.x).toBe(0);
    expect(level?.y).toBeCloseTo(-Math.SQRT1_2);
    expect(level?.z).toBeCloseTo(-Math.SQRT1_2);
    for (const none of [{ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: Number.NaN, y: -1, z: 0 }, { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }]) {
      expect(drawableDirection(none)).toBeNull();
    }
  });

  it('falls back to the default angle for a missing or vertical direction', () => {
    const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    for (const direction of [{ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }]) {
      const frame = frameView(bounds, direction, 1);
      expect(Number.isFinite(frame.right.x + frame.up.y + frame.forward.z)).toBe(true);
      expect(Math.abs(frame.forward.y)).toBeLessThan(0.99);
    }
  });
});
