/**
 * Films a time-lapse of a model being built: each brick drops into place in
 * building order while the camera circles, then the finished model holds.
 * Frames are drawn offscreen and encoded with WebCodecs into an MP4 (or a
 * WebM where the browser cannot make H.264), all in the browser; the encoder
 * library loads only when a video is made.
 */
import { isOpaqueColor } from '../core/colors';
import type { Vec3 } from '../core/grid';
import type { SceneSettings } from '../core/io/modelFile';
import { brickWorldBoxes } from '../core/model/geometry';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import {
  boxCorners,
  bricksAt,
  buildingOrder,
  cameraAt,
  counterText,
  planOrbit,
  planTimeline,
  scheduleStuds,
  studsAt,
  videoSize,
  type TimelapseOptions,
} from '../core/timelapse/timeline';
import type { MeshSource } from '../engine/meshStore';
import { TimelapseRenderer, VIDEO_FOV } from '../engine/timelapseRenderer';
import { breather, untilAborted } from '../instructions/createInstructions';
import { worldBounds } from '../state/selectors';

export interface TimelapseSource {
  readonly name: string;
  readonly bricks: readonly Brick[];
  readonly settings: SceneSettings;
  /** Where the camera starts: the editor's current view direction. */
  readonly direction: Vec3;
}

export interface TimelapseProgress {
  readonly done: number;
  readonly total: number;
  readonly message: string;
}

export interface TimelapseVideo {
  readonly blob: Blob;
  /** "mp4" or "webm". */
  readonly extension: string;
}

/** H.264 in MP4 plays everywhere; the others go in WebM, for browsers that cannot make H.264. */
const CODECS = ['avc', 'vp9', 'av1', 'vp8'] as const;
const CAPTION_FONT = '600 40px "Bricolage Grotesque Variable"';

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Making the video was stopped.', 'AbortError');
}

/** The caption's font, loaded before the first frame draws text with it. */
async function captionFont(): Promise<void> {
  try {
    await document.fonts.load(CAPTION_FONT);
  } catch {
    // the caption falls back to the system font
  }
}

export async function createTimelapse(
  source: TimelapseSource,
  options: TimelapseOptions,
  lookup: PartLookup,
  onProgress?: (progress: TimelapseProgress) => void,
  signal?: AbortSignal,
  meshes: MeshSource | null = null,
): Promise<TimelapseVideo> {
  const bounds = worldBounds(source.bricks, lookup);
  if (!bounds) throw new Error('Place some bricks before making a video.');
  const { width, height } = videoSize(options.shape, options.size);
  const ordered = buildingOrder(source.bricks, lookup, options.order);
  const timeline = planTimeline(ordered.length, options.seconds);
  // fit the camera to every brick's box, not one box round them all: a house among low flower beds fills the picture
  const corners = source.bricks.flatMap((brick) => brickWorldBoxes(brick, lookup).flatMap(boxCorners));
  const orbit = planOrbit(corners, source.direction, width / height, VIDEO_FOV, options.turn, options.seconds);
  const progress = (done: number, message: string): void => onProgress?.({ done, total: timeline.frames, message });

  progress(0, 'Getting the video ready…');
  const media = await untilAborted(import('mediabunny'), signal);
  const codec = await untilAborted(
    media.getFirstEncodableVideoCodec([...CODECS], { width, height, quality: media.QUALITY_HIGH, frameRate: timeline.frameRate }),
    signal,
  );
  if (!codec) throw new Error('This browser cannot make videos. Try a recent Chrome, Edge or Safari.');
  if (options.counter) await untilAborted(captionFont(), signal);

  const format = codec === 'avc' ? new media.Mp4OutputFormat({ fastStart: 'in-memory' }) : new media.WebMOutputFormat();
  const output = new media.Output({ format, target: new media.BufferTarget() });
  let renderer: TimelapseRenderer | null = null;
  try {
    // made inside try, so a failure anywhere after still releases its WebGL context
    renderer = new TimelapseRenderer(lookup, { width, height, settings: source.settings, meshes });
    progress(0, 'Loading parts…');
    const failed = await untilAborted(renderer.preload(source.bricks.map((b) => b.partId)), signal);
    if (failed.length > 0) {
      const parts = failed.length === 1 ? '1 LDraw library part' : `${failed.length} LDraw library parts`;
      throw new Error(`${parts} could not be loaded, so the video would be incomplete. Check your connection and try again.`);
    }
    renderer.light(bounds);
    const studs = scheduleStuds(ordered, lookup, isOpaqueColor);

    const video = new media.CanvasSource(renderer.canvas, { codec, quality: media.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: timeline.frameRate });
    await untilAborted(output.start(), signal);
    const breathe = breather();
    const last = timeline.frames - 1;
    for (let frame = 0; frame <= last; frame++) {
      const bricks = bricksAt(frame, ordered, timeline);
      const caption = options.counter ? counterText(bricks.shown, ordered.length) : null;
      renderer.render(bricks, () => studsAt(studs, bricks.landed.length), cameraAt(orbit, frame / last), caption);
      // waiting here keeps memory flat: the encoder takes frames as fast as it can encode them. A slow
      // encoder (software, on a busy machine) can hold a frame for seconds, so Stop doesn't wait for it:
      // the output is cancelled below, encoder and all
      await untilAborted(video.add(frame / timeline.frameRate, 1 / timeline.frameRate), signal);
      progress(frame + 1, `Filming frame ${frame + 1} of ${timeline.frames}…`);
      await breathe();
      throwIfAborted(signal);
    }
    progress(timeline.frames, 'Saving the video…');
    await untilAborted(output.finalize(), signal);
    // Stop pressed while the last frames were encoded still means stop
    throwIfAborted(signal);
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The video came out empty.');
    return { blob: new Blob([buffer], { type: format.mimeType }), extension: format.fileExtension.replace(/^\./, '') };
  } catch (error: unknown) {
    if (output.state === 'started' || output.state === 'pending') await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    renderer?.dispose();
  }
}
