import { z } from 'zod';
import { DEFAULT_COLOR_ID, getColor } from '../colors';
import { GRID_LIMIT, MAX_LAYER, normalizeRotation } from '../grid';
import type { IdFactory } from '../model/ids';
import { createOccupancy, isOutOfBounds } from '../model/spatial';
import { allBricks, modelFromBricks } from '../model/model';
import type { Brick, Model } from '../model/types';
import type { PartLookup } from '../parts/types';

export const FILE_FORMAT = 'brickbench.model';
export const FILE_VERSION = 1;
export const MAX_BRICKS = 50_000;
/** Most grid cells a model may fill, which keeps collision bookkeeping well inside browser limits. */
export const MAX_CELLS = 2_000_000;
export const BASEPLATE_SIZES = [0, 16, 32, 48, 64] as const;

export type BaseplateSize = (typeof BASEPLATE_SIZES)[number];

export interface SceneSettings {
  readonly baseplateSize: BaseplateSize;
  readonly baseplateColor: number;
}

export interface ModelDocument {
  readonly name: string;
  readonly model: Model;
  readonly settings: SceneSettings;
}

export const DEFAULT_SCENE: SceneSettings = { baseplateSize: 32, baseplateColor: 2 };

const coord = z.number().int().min(-GRID_LIMIT).max(GRID_LIMIT);

const brickSchema = z.object({
  part: z.string().min(1).max(64),
  color: z.number().int().min(0).max(100_000),
  x: coord,
  y: z.number().int().min(0).max(MAX_LAYER),
  z: coord,
  r: z.number().int().min(0).max(3),
});

const settingsSchema = z.object({
  baseplateSize: z.union(BASEPLATE_SIZES.map((size) => z.literal(size))),
  baseplateColor: z.number().int().min(0),
});

const fileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(FILE_VERSION),
  name: z.string().max(120),
  settings: settingsSchema.optional(),
  bricks: z.array(brickSchema).max(MAX_BRICKS),
});

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface ParsedDocument {
  readonly doc: ModelDocument;
  readonly warnings: readonly string[];
  /** Part ids the file used that this editor does not know; their bricks were left out. */
  readonly unknownParts: readonly string[];
  /** Bricks in the file that did not make it into the model, for any reason. */
  readonly skippedBricks: number;
}

export function serializeDocument(doc: ModelDocument): string {
  const file: z.infer<typeof fileSchema> = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: doc.name,
    settings: { ...doc.settings },
    bricks: allBricks(doc.model).map((b) => ({ part: b.partId, color: b.colorId, x: b.x, y: b.y, z: b.z, r: b.r })),
  };
  return JSON.stringify(file);
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : 'file';
  return `${path}: ${issue.message}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

type BrickRecord = z.infer<typeof brickSchema>;

interface Collected {
  readonly bricks: Brick[];
  readonly warnings: string[];
  readonly unknownParts: string[];
  readonly skipped: number;
}

/**
 * Turns validated records into bricks, dropping what the editor could not
 * handle: unknown parts, bricks off the grid and bricks overlapping others.
 */
function collectBricks(records: readonly BrickRecord[], lookup: PartLookup, nextId: IdFactory): Result<Collected> {
  const unknownParts = new Set<string>();
  const skipped = { unknown: 0, outside: 0, overlapping: 0 };
  let recolored = 0;
  const occupancy = createOccupancy(lookup);
  const bricks: Brick[] = [];

  for (const record of records) {
    if (!lookup(record.part)) {
      unknownParts.add(record.part);
      skipped.unknown += 1;
      continue;
    }
    const knownColor = getColor(record.color) !== undefined;
    const candidate: Brick = {
      id: '',
      partId: record.part,
      colorId: knownColor ? record.color : DEFAULT_COLOR_ID,
      x: record.x,
      y: record.y,
      z: record.z,
      r: normalizeRotation(record.r),
    };
    if (isOutOfBounds(candidate, lookup)) {
      skipped.outside += 1;
      continue;
    }
    if (!occupancy.tryAdd(candidate)) {
      skipped.overlapping += 1;
      continue;
    }
    if (occupancy.cells > MAX_CELLS) {
      return { ok: false, error: `This model is too big to open: it fills more than ${MAX_CELLS.toLocaleString('en')} grid cells.` };
    }
    if (!knownColor) recolored += 1;
    bricks.push({ ...candidate, id: nextId() });
  }

  const warnings: string[] = [];
  if (skipped.unknown > 0) {
    warnings.push(`Skipped ${plural(skipped.unknown, 'brick')} with unknown parts: ${[...unknownParts].slice(0, 5).join(', ')}.`);
  }
  if (skipped.outside > 0) warnings.push(`Skipped ${plural(skipped.outside, 'brick')} outside the building area.`);
  if (skipped.overlapping > 0) {
    warnings.push(`Skipped ${plural(skipped.overlapping, 'brick')} that overlapped ${skipped.overlapping === 1 ? 'another' : 'others'}.`);
  }
  if (recolored > 0) warnings.push(`Recoloured ${plural(recolored, 'brick')} that used unknown colours.`);
  const skippedCount = skipped.unknown + skipped.outside + skipped.overlapping;
  return { ok: true, value: { bricks, warnings, unknownParts: [...unknownParts], skipped: skippedCount } };
}

/** Parses and validates a model file. Anything the editor cannot use is dropped or replaced, with warnings. */
export function parseDocument(text: string, lookup: PartLookup, nextId: IdFactory): Result<ParsedDocument> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }

  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Not a BrickBench model (${first ? describeIssue(first) : 'unknown problem'}).` };
  }

  const collected = collectBricks(parsed.data.bricks, lookup, nextId);
  if (!collected.ok) return collected;

  const settings = parsed.data.settings ?? DEFAULT_SCENE;
  const warnings = [...collected.value.warnings];
  const baseplateColor = getColor(settings.baseplateColor) ? settings.baseplateColor : DEFAULT_SCENE.baseplateColor;
  if (baseplateColor !== settings.baseplateColor) warnings.push('The baseplate colour was not recognised, so the default was used.');

  return {
    ok: true,
    value: {
      doc: {
        name: parsed.data.name,
        model: modelFromBricks(collected.value.bricks),
        settings: { ...settings, baseplateColor },
      },
      warnings,
      unknownParts: collected.value.unknownParts,
      skippedBricks: collected.value.skipped,
    },
  };
}
