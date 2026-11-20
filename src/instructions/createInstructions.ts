import { getColor } from '../core/colors';
import type { Vec3 } from '../core/grid';
import { coverImageArea, pageCount, pageGeometry, partsBoxCapacity, stepImageArea, type PageSize, type PartCount } from '../core/instructions/layout';
import type { InstructionPlan } from '../core/instructions/plan';
import { bookletPlan, bookletSteps, type BookletOrder, type BookletStep } from '../core/instructions/planView';
import { DEFAULT_STEP_OPTIONS } from '../core/instructions/steps';
import type { SceneSettings } from '../core/io/modelFile';
import { buildPartsList } from '../core/io/partsList';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { GeometryCache } from '../engine/geometryCache';
import { InstructionRenderer } from '../engine/instructionRenderer';
import { MaterialLibrary } from '../engine/materials';
import type { MeshSource } from '../engine/meshStore';
import { ThumbnailRenderer } from '../engine/thumbnails';
import { BookletWriter, type PartArt } from './bookletWriter';

export interface InstructionOptions {
  readonly pageSize: PageSize;
  /** For steps planned automatically, and for bricks the user's steps leave out. */
  readonly partsPerStep: number;
  readonly order: BookletOrder;
  /** Outline the parts each step adds. */
  readonly highlight: boolean;
}

export const DEFAULT_INSTRUCTION_OPTIONS: InstructionOptions = {
  pageSize: 'a4',
  partsPerStep: DEFAULT_STEP_OPTIONS.partsPerStep,
  order: DEFAULT_STEP_OPTIONS.order,
  highlight: true,
};

export interface InstructionSource {
  readonly name: string;
  readonly bricks: readonly Brick[];
  readonly settings: SceneSettings;
  /** Direction the pictures are drawn from: the editor camera's current view. */
  readonly direction: Vec3;
  /** The steps as the user arranged them, if they have. */
  readonly plan?: InstructionPlan | undefined;
}

/** What a step page says above its picture: the sub-assembly it builds, or that it adds one. */
function captionOf(page: BookletStep): string | undefined {
  if (!page.assembly) return undefined;
  return page.assembly.adds ? `Add the ${page.assembly.name}` : page.assembly.name;
}

export interface InstructionProgress {
  readonly done: number;
  readonly total: number;
  readonly message: string;
}

/** Pixel width of the pictures; their height follows the page's picture area. */
const STEP_PIXELS = 1600;
const COVER_PIXELS = 1800;
/** Parts smaller than roughly a 2 × 2 brick are drawn smaller in parts boxes, keeping sizes comparable. */
const PART_MIN_RADIUS = 1.35;

const keyOf = (part: { readonly partId: string; readonly colorId: number }): string => `${part.partId}|${part.colorId}`;

function countParts(bricks: readonly Brick[], lookup: PartLookup): PartCount[] {
  return buildPartsList(bricks, lookup).map((row) => ({ key: keyOf(row), count: row.quantity }));
}

const YIELD_EVERY_MS = 40;

/**
 * Resolves on the browser's next task. MessageChannel keeps working at full
 * speed in background tabs, where timers get throttled to a crawl.
 */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Yields to the browser at most every few dozen milliseconds, so progress and Stop stay live. */
export function breather(): (force?: boolean) => Promise<void> {
  let last = performance.now();
  return async (force = false) => {
    if (!force && performance.now() - last < YIELD_EVERY_MS) return;
    await nextTask();
    last = performance.now();
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Making the instructions was stopped.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function missingPartsError(count: number): Error {
  const parts = count === 1 ? '1 LDraw library part' : `${count} LDraw library parts`;
  return new Error(`${parts} could not be loaded, so the pictures would be incomplete. Check your connection and try again.`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function partArt(key: string, lookup: PartLookup, thumbnails: ThumbnailRenderer): PartArt {
  const [partId = '', color = ''] = key.split('|');
  const colorId = Number(color);
  const part = lookup(partId);
  const details = [getColor(colorId)?.name, part?.ldraw?.file.replace(/\.dat$/, '')].filter(Boolean);
  return {
    image: thumbnails.render(partId, colorId, PART_MIN_RADIUS),
    name: part?.name ?? partId,
    detail: details.join(' · '),
  };
}

/** Settles with the work, or rejects the moment the signal aborts. */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = (): void => reject(new DOMException('Stopped.', 'AbortError'));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** Loads library meshes for both renderers, so no picture shows a stand-in box. */
async function loadParts(caches: readonly { preload(ids: Iterable<string>): Promise<string[]> }[], bricks: readonly Brick[], signal: AbortSignal | undefined): Promise<void> {
  const ids = bricks.map((b) => b.partId);
  const failed = new Set((await untilAborted(Promise.all(caches.map((c) => c.preload(ids))), signal)).flat());
  if (failed.size > 0) throw missingPartsError(failed.size);
}

interface Drawing {
  readonly source: InstructionSource;
  readonly options: InstructionOptions;
  readonly lookup: PartLookup;
  readonly pictures: InstructionRenderer;
  readonly thumbnails: ThumbnailRenderer;
  readonly steps: readonly BookletStep[];
  readonly inventory: readonly PartCount[];
  readonly advance: (message: string) => Promise<void>;
}

/** Draws every page into a booklet: parts list art, the cover, then each step. */
async function drawBooklet(d: Drawing): Promise<BookletWriter> {
  const page = pageGeometry(d.options.pageSize);
  const parts = new Map<string, PartArt>();
  for (const item of d.inventory) {
    parts.set(item.key, partArt(item.key, d.lookup, d.thumbnails));
    await d.advance('Drawing the parts…');
  }
  const meta = {
    title: d.source.name,
    pieces: d.source.bricks.length,
    steps: d.steps.length,
    totalPages: pageCount(page, d.steps.length, d.inventory.length),
    date: today(),
  };
  const writer = await BookletWriter.create(d.options.pageSize, meta, parts);

  const cover = coverImageArea(page);
  const coverAspect = cover.w / cover.h;
  writer.addCover(d.pictures.renderStep(d.source.bricks, [], COVER_PIXELS, Math.round(COVER_PIXELS / coverAspect)), coverAspect);
  writer.addInventory(d.inventory);
  await d.advance('Drawing the cover…');

  const area = stepImageArea(page);
  const stepAspect = area.w / area.h;
  const stepHeight = Math.round(STEP_PIXELS / stepAspect);
  let framed: { readonly frame: readonly Brick[]; readonly view: Vec3 } | null = null;
  for (const step of d.steps) {
    // a sub-assembly is framed on its own, and a step may be drawn from a view of its own
    const view = step.view ?? d.source.direction;
    if (!framed || framed.frame !== step.frame || framed.view !== view) {
      // a sub-assembly is built in the hand, off the baseplate
      d.pictures.setView(step.frame, view, step.assembly?.adds !== false);
      framed = { frame: step.frame, view };
    }
    const picture = d.pictures.renderStep(step.built, step.added, STEP_PIXELS, stepHeight);
    writer.addStep(step.number, picture, stepAspect, countParts(step.parts, d.lookup), captionOf(step));
    await d.advance(`Drawing step ${step.number} of ${d.steps.length}…`);
  }
  return writer;
}

/**
 * Makes a printable building-instructions booklet: a cover, the parts list,
 * and one page per step showing the parts to add and the model so far.
 */
export async function createInstructionsPdf(
  source: InstructionSource,
  options: InstructionOptions,
  lookup: PartLookup,
  onProgress?: (progress: InstructionProgress) => void,
  signal?: AbortSignal,
  meshes: MeshSource | null = null,
): Promise<Blob> {
  if (source.bricks.length === 0) throw new Error('Place some bricks before making instructions.');
  const bricks = new Map(source.bricks.map((b) => [b.id, b]));
  // a step with more kinds of part than its parts box shows goes over several pages
  const steps = bookletSteps(bookletPlan(bricks, source.plan, options, lookup), bricks, partsBoxCapacity(pageGeometry(options.pageSize)));
  const inventory = countParts(source.bricks, lookup);
  const total = inventory.length + steps.length + 2;
  let done = 0;
  const breathe = breather();
  const advance = async (message: string): Promise<void> => {
    done += 1;
    onProgress?.({ done, total, message });
    await breathe();
    throwIfAborted(signal);
  };

  const geometries = new GeometryCache(lookup, meshes);
  const materials = new MaterialLibrary();
  let thumbnails: ThumbnailRenderer | null = null;
  let renderer: InstructionRenderer | null = null;
  try {
    // created inside try so a failure part-way still releases what was made
    thumbnails = new ThumbnailRenderer(geometries, materials);
    renderer = new InstructionRenderer(lookup, { baseplate: source.settings, highlight: options.highlight, meshes });
    onProgress?.({ done, total, message: 'Loading parts…' });
    await loadParts([geometries, renderer], source.bricks, signal);
    // the cover shows the whole model from the booklet's view; each step sets its own
    renderer.setView(source.bricks, source.direction);
    const writer = await drawBooklet({ source, options, lookup, pictures: renderer, thumbnails, steps, inventory, advance });
    onProgress?.({ done, total, message: 'Saving the PDF…' });
    await breathe(true);
    const blob = writer.finish();
    await advance('Done');
    return blob;
  } finally {
    renderer?.dispose();
    thumbnails?.dispose();
    geometries.dispose();
    materials.dispose();
  }
}
