import { describe, expect, it } from 'bun:test';
import { makeBrick } from '../model/testUtils';
import type { Vec3 } from '../grid';
import type { Brick } from '../model/types';
import { getPart } from '../parts/catalog';
import { isOpaqueColor } from '../colors';
import { createIdFactory } from '../model/ids';
import { allBricks } from '../model/model';
import { buildSpatialIndex } from '../model/spatial';
import { visibleStuds } from '../model/studs';
import { cottageSample } from '../../samples/cottage';
import {
  boxCorners,
  bricksAt,
  buildingOrder,
  cameraAt,
  counterText,
  DROP_PLATES,
  FRAME_RATE,
  planOrbit,
  planTimeline,
  scheduleStuds,
  studsAt,
  videoSize,
} from './timeline';

const tower = [makeBrick({ id: 'top', y: 3 }), makeBrick({ id: 'bottom', y: 0 }), makeBrick({ id: 'side', x: 8, y: 0 })];

describe('the order bricks arrive in', () => {
  it('is the order they were placed in, or bottom up', () => {
    expect(buildingOrder(tower, getPart, 'build-order').map((b) => b.id)).toEqual(['top', 'bottom', 'side']);
    const layered = buildingOrder(tower, getPart, 'layers').map((b) => b.id);
    expect(layered.at(-1)).toBe('top');
    expect(new Set(layered)).toEqual(new Set(['top', 'bottom', 'side']));
  });
});

describe('the timeline', () => {
  it('spreads the bricks over the video and holds the finished model at the end', () => {
    const timeline = planTimeline(100, 20);
    expect(timeline.frames).toBe(20 * FRAME_RATE);
    expect(timeline.starts[0]).toBe(0);
    for (let i = 1; i < timeline.starts.length; i++) expect(timeline.starts[i]).toBeGreaterThanOrEqual(timeline.starts[i - 1] ?? 0);
    const lastLanding = (timeline.starts.at(-1) ?? 0) + timeline.dropFrames;
    // two and a half seconds of the finished model
    expect(timeline.frames - 1 - lastLanding).toBe(75);
  });

  it('keeps a short video mostly building, and copes with one brick or none', () => {
    const short = planTimeline(10, 5);
    expect((short.starts.at(-1) ?? 0) + short.dropFrames).toBe(short.frames - 1 - Math.floor(short.frames / 4));
    expect(planTimeline(1, 5).starts).toEqual([0]);
    expect(planTimeline(0, 5).starts).toEqual([]);
    expect(planTimeline(5, 0).frames).toBe(2);
  });

  it('drops each brick in from above, landing it where it belongs', () => {
    const timeline = planTimeline(3, 10);
    const ordered = buildingOrder(tower, getPart, 'build-order');
    expect(bricksAt(0, ordered, timeline)).toEqual({ landed: [], falling: [{ ...(tower[0] as Brick), y: 3 + DROP_PLATES }], shown: 1 });
    const halfway = bricksAt(Math.floor(timeline.dropFrames / 2), ordered, timeline);
    expect(halfway.falling[0]?.y).toBeGreaterThan(3);
    expect(halfway.falling[0]?.y).toBeLessThan(3 + DROP_PLATES);
    const end = bricksAt(timeline.frames - 1, ordered, timeline);
    expect(end).toEqual({ landed: ordered, falling: [], shown: 3 });
  });
});

describe('the camera', () => {
  const bounds = { min: { x: -4, y: 0, z: -2 }, max: { x: 4, y: 3.6, z: 2 } };
  const front = { x: 0, y: -0.5, z: -0.866 };

  /** The largest share of the picture's half-width and half-height any corner of the box reaches, seen from the camera. */
  function reach(pose: ReturnType<typeof cameraAt>, aspect: number): { across: number; up: number } {
    const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
    const forwardRaw = sub(pose.target, pose.position);
    const length = Math.hypot(forwardRaw.x, forwardRaw.y, forwardRaw.z);
    const forward = { x: forwardRaw.x / length, y: forwardRaw.y / length, z: forwardRaw.z / length };
    const flat = Math.hypot(forward.x, forward.z);
    const right = { x: -forward.z / flat, y: 0, z: forward.x / flat };
    const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
    const tan = Math.tan((35 * Math.PI) / 360);
    let across = 0;
    let upward = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = sub({ x, y, z }, pose.position);
          const depth = dot(p, forward);
          across = Math.max(across, Math.abs(dot(p, right) / depth / (tan * aspect) - pose.shift.x));
          upward = Math.max(upward, Math.abs(dot(p, up) / depth / tan - pose.shift.y));
        }
      }
    }
    return { across, up: upward };
  }

  it('keeps to the side and height of the editor view, with the whole model in the picture all the way round', () => {
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      const orbit = planOrbit(boxCorners(bounds), front, aspect, 35, true, 20);
      expect(orbit.target).toEqual({ x: 0, y: 1.8, z: 0 });
      expect(orbit.elevation).toBeCloseTo(Math.PI / 6, 3);
      expect(orbit.sweep).toBeCloseTo(2 * Math.PI, 6);
      let fullest = 0;
      for (let t = 0; t <= 1; t += 1 / 64) {
        const { across, up } = reach(cameraAt(orbit, t), aspect);
        expect(Math.max(across, up)).toBeLessThanOrEqual(0.89);
        fullest = Math.max(fullest, across, up);
      }
      // and as close as that allows: at some point the model fills the picture to its margin
      expect(fullest).toBeGreaterThan(0.85);
    }
    const start = cameraAt(planOrbit(boxCorners(bounds), front, 16 / 9, 35, true, 20), 0);
    // in front of the model (+z) and above it
    expect(start.position.z).toBeGreaterThan(0);
    expect(start.position.y).toBeGreaterThan(1.8);
  });

  it('circles once in a long video, part way in a short one, and not at all when asked to keep still', () => {
    expect(planOrbit(boxCorners(bounds), front, 1, 35, true, 5).sweep).toBeCloseTo(Math.PI / 2, 6);
    const still = planOrbit(boxCorners(bounds), front, 1, 35, false, 20);
    expect(cameraAt(still, 0.5)).toEqual(cameraAt(still, 0));
    const full = planOrbit(boxCorners(bounds), front, 1, 35, true, 60);
    expect(cameraAt(full, 1).position.x).toBeCloseTo(cameraAt(full, 0).position.x, 6);
    expect(cameraAt(full, 0.5).position.z).toBeLessThan(0);
  });

  it('stays out of the ground and off the top of the model', () => {
    expect(planOrbit(boxCorners(bounds), { x: 0, y: 0.2, z: -1 }, 1, 35, false, 10).elevation).toBeCloseTo((12 * Math.PI) / 180, 6);
    expect(planOrbit(boxCorners(bounds), { x: 0, y: -1, z: 0 }, 1, 35, false, 10).elevation).toBeCloseTo((60 * Math.PI) / 180, 6);
  });
});

describe('the video', () => {
  it('comes in the usual sizes, all even', () => {
    expect(videoSize('landscape', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(videoSize('portrait', '720p')).toEqual({ width: 720, height: 1280 });
    expect(videoSize('square', '720p')).toEqual({ width: 720, height: 720 });
  });

  it('counts the bricks in a corner', () => {
    expect(counterText(312, 1504)).toBe('312 / 1,504 bricks');
    expect(counterText(1, 1)).toBe('1 / 1 brick');
  });
});

describe('studs while the model builds', () => {
  const cottage = allBricks(cottageSample(createIdFactory('c')).model);
  const opaque = (colorId: number): boolean => isOpaqueColor(colorId);

  it('shows exactly the studs the editor would for every stage of the build, in either order', () => {
    const key = (s: { x: number; y: number; z: number; colorId: number }): string => `${s.x},${s.y},${s.z},${s.colorId}`;
    for (const order of ['build-order', 'layers'] as const) {
      const ordered = buildingOrder(cottage, getPart, order);
      const schedule = scheduleStuds(ordered, getPart, opaque);
      for (let landed = 0; landed <= ordered.length; landed++) {
        const built = ordered.slice(0, landed);
        const colours = new Map(built.map((b) => [b.id, b.colorId]));
        const expected = visibleStuds(built, buildSpatialIndex(built, getPart), getPart, (id) => opaque(colours.get(id) ?? -1));
        expect(studsAt(schedule, landed).map(key).sort()).toEqual(expected.map(key).sort());
      }
    }
  });
});
