/**
 * Opens an LDraw model (.ldr, .mpd, or the model inside a Studio .io file)
 * as a BrickBench model, and reports what could not come in: parts
 * BrickBench lacks, parts tipped over or off the stud grid, and parts that
 * collide once on the grid. Parts come in in the model's own order, so its
 * building steps become the order a time-lapse builds it in, and its steps
 * and submodels those of its instructions (see seedPlan).
 */
import { getColor } from '../../colors';
import { GRID_LIMIT, MAX_LAYER, STUD_STEP, cleanZero, rotatedSize, type Rotation } from '../../grid';
import type { PartNumbers } from '../../inventory/match';
import { groupCellBox } from '../../model/geometry';
import type { IdFactory } from '../../model/ids';
import { modelFromBricks } from '../../model/model';
import type { Brick } from '../../model/types';
import type { PartDef, PartLookup } from '../../parts/types';
import { BASEPLATE_SIZES, DEFAULT_SCENE, MAX_BRICKS, collectBricks, type BrickRecord, type ModelDocument, type Result, type SceneSettings } from '../modelFile';
import { toPalette, type PaletteMatch } from './colours';
import { flatten, type Placement } from './flatten';
import { createPartResolver, isModelFile, isPrimitive, numberOfFile, type PartResolver, type ResolvedPart } from './match';
import { readLDraw, type LDrawFile } from './read';
import { seedPlan, type SteppedBrick } from './seedPlan';
import { gridSpotOf, latticeOf, quarterTurnOf, snapToLattice, type GridSpot, type Lattice } from './toGrid';

/**
 * Why a part stayed out: BrickBench has no such part · the model keeps it
 * in another file · it is one of LDraw's drawing shapes, not a part · it is
 * tipped over, on its side or at an angle · it sits off the stud grid · it
 * overlaps a part already in · it is beyond the building area.
 */
export type LeftOutReason = 'missing' | 'missing-file' | 'shapes' | 'turned' | 'off-grid' | 'overlapping' | 'outside';

export interface PartTally {
  readonly label: string;
  readonly count: number;
}

export interface LeftOutGroup {
  readonly reason: LeftOutReason;
  readonly count: number;
  readonly parts: readonly PartTally[];
}

export interface Recolouring {
  /** The model's colour: "Light Grey", "#336699". */
  readonly from: string;
  /** The BrickBench colour it came in as. */
  readonly to: string;
  readonly count: number;
}

export interface ImportReport {
  /** Parts the model places, a submodel's parts counted each time it is used. */
  readonly parts: number;
  /** Parts that came in. */
  readonly placed: number;
  /** In the order of LeftOutReason, only reasons that apply. */
  readonly leftOut: readonly LeftOutGroup[];
  /** Printed and stickered parts that came in plain. */
  readonly plain: readonly PartTally[];
  /**
   * Submodels moved up to a quarter stud or half a plate to line up with the rest,
   * labelled by name, counting the parts that came in with them.
   */
  readonly moved: readonly PartTally[];
  /** Submodels stood at an angle, turned square to come in; labelled and counted as `moved`. */
  readonly squared: readonly PartTally[];
  /** Colours BrickBench lacks, brought in as the nearest it has. */
  readonly recoloured: readonly Recolouring[];
  /** Part lines that could not be read. */
  readonly unreadable: number;
  /** Uses of submodels left out because they contain themselves (or nest absurdly deep). */
  readonly looping: number;
}

export interface ImportedModel {
  readonly doc: ModelDocument;
  readonly report: ImportReport;
}

export interface ImportContext {
  readonly lookup: PartLookup;
  readonly numbers: PartNumbers;
  readonly nextId: IdFactory;
}

const REASONS: readonly LeftOutReason[] = ['missing', 'missing-file', 'shapes', 'turned', 'off-grid', 'overlapping', 'outside'];
/** Lines followed in all before giving up on a model that nests submodels endlessly. */
const MAX_REFERENCES = MAX_BRICKS * 20;
const MAX_NAME = 120;
const OPENABLE_EXTENSION = /\.(?:ldr|mpd|l3b|dat|io)$/i;
/** Titles editors and the LDraw model repository give a model's main file. */
const NO_TITLE = /^(?:untitled(?: model)?|new model|main(?: model)?|model)$/i;

/** A placement matched to a part, turned in quarter turns and ready for the grid. */
interface Candidate {
  readonly part: PartDef;
  readonly resolved: ResolvedPart;
  readonly label: string;
  readonly r: Rotation;
  readonly spot: GridSpot;
  readonly colour: PaletteMatch;
  /** The use of a submodel it came with, and the submodel turned square around it (see Placement). */
  readonly group: string;
  readonly groupName: string;
  readonly squared: string | null;
  /** The submodels and steps of the lines leading to it (see Placement). */
  readonly submodels: readonly string[];
  readonly steps: readonly number[];
}

/** A candidate on a whole grid cell, and whether its submodel was moved to get there. */
interface OnGrid {
  readonly candidate: Candidate;
  readonly cell: GridSpot;
  readonly moved: boolean;
}

interface Rejected {
  readonly reason: LeftOutReason;
  readonly label: string;
}

interface Settled {
  readonly record: BrickRecord;
  readonly on: OnGrid;
}

function count(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

/** Most first, then by name, so a report reads the same each time. */
function tallies(counts: ReadonlyMap<string, number>): PartTally[] {
  return [...counts]
    .map(([label, n]) => ({ label, count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** "71427c01.dat" → "71427c01"; model files keep their extension. */
function fileLabel(file: string): string {
  return file.trim().replace(/\.dat$/i, '');
}

/** A submodel as a person would name it: "10156 - TRUCK.LDR" → "10156 - TRUCK". */
function submodelLabel(file: string): string {
  return file.trim().replace(/\.(?:ldr|mpd|l3b|dat)$/i, '');
}

/** The model's title, unless it is an editor's placeholder; else the file's name. */
export function modelName(main: LDrawFile, fileName: string): string {
  const title = main.title.trim();
  const stem = fileName.replace(/^.*[\\/]/, '').replace(OPENABLE_EXTENSION, '').trim();
  const name = title && !NO_TITLE.test(title) ? title : stem;
  return (name || 'Imported model').slice(0, MAX_NAME);
}

function toCandidate(placement: Placement, resolver: PartResolver, lookup: PartLookup): Candidate | Rejected {
  const resolved = resolver.resolve(placement.file);
  const part = resolved ? lookup(resolved.partId) : undefined;
  if (!resolved || !part) {
    const reason = isModelFile(placement.file) ? 'missing-file' : isPrimitive(placement.file) ? 'shapes' : 'missing';
    return { reason, label: fileLabel(placement.file) };
  }
  const label = `${part.name} (${numberOfFile(placement.file)})`;
  const r = quarterTurnOf(placement.matrix);
  if (r === null) return { reason: 'turned', label };
  const spot = gridSpotOf(part, placement.position, r);
  if (!spot) return { reason: 'missing', label };
  const { group, groupName, squared, submodels, steps } = placement;
  return { part, resolved, label, r, spot, colour: toPalette(placement.colour), group, groupName, squared, submodels, steps };
}

/**
 * `own` shifted by whole steps (half studs along x and z, plates up) to lie
 * as close to `model` as it can: at most a quarter stud, or half a plate, off.
 */
function nearestTo(own: Lattice, model: Lattice): Lattice {
  const near = (a: number, b: number, step: number): number => a - step * Math.round((a - b) / step);
  return { x: near(own.x, model.x, STUD_STEP), y: near(own.y, model.y, 1), z: near(own.z, model.z, STUD_STEP) };
}

/**
 * Puts the candidates on whole cells, in the model's order. Each use of a
 * submodel goes on as one piece, on the grid most of the model shares, or
 * moved up to half a cell onto a grid of its own when more of its parts fit
 * that way (a train body resting a little above its bogies, say). Parts
 * that fit neither are off the grid.
 */
function fitToGrid(candidates: readonly Candidate[]): { readonly onGrid: OnGrid[]; readonly offGrid: Candidate[] } {
  const model = latticeOf(candidates.map((c) => c.spot));
  const members = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = members.get(candidate.group);
    if (group) group.push(candidate);
    else members.set(candidate.group, [candidate]);
  }

  const lattices = new Map<string, { readonly lattice: Lattice; readonly moved: boolean }>();
  for (const [group, parts] of members) {
    const own = nearestTo(latticeOf(parts.map((c) => c.spot)), model);
    const fitting = (lattice: Lattice): number => parts.filter((c) => snapToLattice(c.spot, lattice) !== null).length;
    const moved = fitting(own) > fitting(model);
    lattices.set(group, { lattice: moved ? own : model, moved });
  }

  const onGrid: OnGrid[] = [];
  const offGrid: Candidate[] = [];
  for (const candidate of candidates) {
    const fit = lattices.get(candidate.group) ?? { lattice: model, moved: false };
    const cell = snapToLattice(candidate.spot, fit.lattice);
    if (cell) onGrid.push({ candidate, cell, moved: fit.moved });
    else offGrid.push(candidate);
  }
  return { onGrid, offGrid };
}

interface Span {
  readonly lo: number;
  readonly hi: number;
}

/**
 * Where the model is along one axis: from its lowest to its highest cell,
 * or, when that is more than `limit` (a stray part far off), the stretch
 * around the median part, so one stray part cannot take the rest out of
 * the building area with it.
 */
function modelSpan(spans: readonly Span[], limit: number): Span {
  let lo = Infinity, hi = -Infinity;
  for (const span of spans) {
    lo = Math.min(lo, span.lo);
    hi = Math.max(hi, span.hi);
  }
  if (hi - lo <= limit) return { lo, hi };
  const middles = spans.map((span) => (span.lo + span.hi) / 2).sort((a, b) => a - b);
  const median = middles[Math.floor(middles.length / 2)] ?? 0;
  let coreLo = Infinity, coreHi = -Infinity;
  for (const span of spans) {
    if (Math.abs((span.lo + span.hi) / 2 - median) > limit / 2) continue;
    coreLo = Math.min(coreLo, span.lo);
    coreHi = Math.max(coreHi, span.hi);
  }
  return { lo: coreLo, hi: coreHi };
}

/** Records for the parts on the grid, moved so the model stands on the ground in the middle of the scene. */
function settle(placed: readonly OnGrid[]): Settled[] {
  const sizes = placed.map(({ candidate }) => rotatedSize(candidate.part.w, candidate.part.d, candidate.r));
  const x = modelSpan(placed.map(({ cell }, i) => ({ lo: cell.x, hi: cell.x + (sizes[i]?.w ?? 1) })), 2 * GRID_LIMIT);
  const z = modelSpan(placed.map(({ cell }, i) => ({ lo: cell.z, hi: cell.z + (sizes[i]?.d ?? 1) })), 2 * GRID_LIMIT);
  const y = modelSpan(placed.map(({ candidate, cell }) => ({ lo: cell.y, hi: cell.y + candidate.part.h })), MAX_LAYER);
  const dx = -Math.floor((x.lo + x.hi) / 2);
  const dz = -Math.floor((z.lo + z.hi) / 2);
  return placed.map((on) => ({
    on,
    record: {
      part: on.candidate.part.id,
      color: on.candidate.colour.colorId,
      x: cleanZero(on.cell.x + dx),
      y: cleanZero(on.cell.y - y.lo),
      z: cleanZero(on.cell.z + dz),
      r: on.candidate.r,
    },
  }));
}

/** No baseplate under a model that brings its own; else the smallest that holds it, if any does. */
function sceneFor(bricks: readonly Brick[], lookup: PartLookup): SceneSettings {
  const ownBaseplate = bricks.some((b) => b.y === 0 && lookup(b.partId)?.keywords.includes('baseplate'));
  if (bricks.length === 0 || ownBaseplate) return { ...DEFAULT_SCENE, baseplateSize: 0 };
  const box = groupCellBox(bricks, lookup);
  const reach = 2 * Math.max(-box.x0, box.x1, -box.z0, box.z1);
  return { ...DEFAULT_SCENE, baseplateSize: BASEPLATE_SIZES.find((size) => size > 0 && size >= reach) ?? 0 };
}

/** Gathers the report while a model comes in. */
class ReportBuilder {
  private readonly leftOut = new Map<LeftOutReason, Map<string, number>>();
  private readonly plain = new Map<string, number>();
  private readonly moved = new Map<string, number>();
  private readonly squared = new Map<string, number>();
  private readonly recoloured = new Map<string, Recolouring>();

  leave(reason: LeftOutReason, label: string): void {
    const counts = this.leftOut.get(reason) ?? new Map<string, number>();
    count(counts, label);
    this.leftOut.set(reason, counts);
  }

  /** Notes what changed about a part that came in: its print, its colour, its submodel moved or turned. */
  cameIn({ candidate, moved }: OnGrid): void {
    if (candidate.resolved.plain) count(this.plain, candidate.label);
    if (moved) count(this.moved, submodelLabel(candidate.groupName));
    if (candidate.squared !== null) count(this.squared, submodelLabel(candidate.squared));
    if (candidate.colour.exact) return;
    const to = getColor(candidate.colour.colorId)?.name ?? String(candidate.colour.colorId);
    const key = `${candidate.colour.name}\u0000${to}`;
    const held = this.recoloured.get(key);
    this.recoloured.set(key, { from: candidate.colour.name, to, count: (held?.count ?? 0) + 1 });
  }

  build(parts: number, placed: number, unreadable: number, looping: number): ImportReport {
    return {
      parts,
      placed,
      leftOut: REASONS.flatMap((reason) => {
        const counts = this.leftOut.get(reason);
        if (!counts) return [];
        const tallied = tallies(counts);
        return [{ reason, count: tallied.reduce((sum, p) => sum + p.count, 0), parts: tallied }];
      }),
      plain: tallies(this.plain),
      moved: tallies(this.moved),
      squared: tallies(this.squared),
      recoloured: [...this.recoloured.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from)),
      unreadable,
      looping,
    };
  }
}

/** Why a file gave no parts to place. */
function noPartsError(badLines: number, looping: number): string {
  if (badLines > 0) return 'BrickBench could not read the parts in this file.';
  if (looping > 0) return 'This model’s submodels contain themselves, so there are no parts to open.';
  return 'There are no parts in this file.';
}

/** Parses LDraw text into a model, leaving out (and reporting) what BrickBench cannot build. */
export function importLDraw(text: string, fileName: string, context: ImportContext): Result<ImportedModel> {
  const doc = readLDraw(text, fileName);
  const resolver = createPartResolver(context.numbers);
  const flat = flatten(doc, (file) => resolver.exact(file) !== null, { maxParts: MAX_BRICKS, maxReferences: MAX_REFERENCES });
  if (!flat.ok) return flat;
  const { placements, skipped } = flat.value;
  if (placements.length === 0) return { ok: false, error: noPartsError(doc.badLines, skipped) };

  const report = new ReportBuilder();
  const candidates = placements.flatMap((placement) => {
    const candidate = toCandidate(placement, resolver, context.lookup);
    if (!('reason' in candidate)) return [candidate];
    report.leave(candidate.reason, candidate.label);
    return [];
  });
  const { onGrid, offGrid } = fitToGrid(candidates);
  for (const candidate of offGrid) report.leave('off-grid', candidate.label);

  const settled = settle(onGrid);
  const collected = collectBricks(settled.map((s) => s.record), context.lookup, context.nextId);
  if (!collected.ok) return collected;
  const rejected = new Map(collected.value.rejected.map(({ record, reason }) => [record, reason]));
  for (const { record, on } of settled) {
    const reason = rejected.get(record);
    if (reason) report.leave(reason === 'unknown' ? 'missing' : reason, on.candidate.label);
    else report.cameIn(on);
  }

  const { bricks, ids } = collected.value;
  const model = modelFromBricks(bricks);
  // the steps of the bricks that came in, in the model's order
  const stepped = settled.flatMap(({ on }, i): SteppedBrick[] => {
    const id = ids[i];
    const { group, submodels, steps } = on.candidate;
    return id ? [{ id, group, submodels, steps }] : [];
  });
  const plan = seedPlan(stepped, { bricks: model.bricks, lookup: context.lookup });
  return {
    ok: true,
    value: {
      doc: { name: modelName(doc.main, fileName), model: plan ? { ...model, plan } : model, settings: sceneFor(bricks, context.lookup) },
      report: report.build(placements.length, bricks.length, doc.badLines, skipped),
    },
  };
}
