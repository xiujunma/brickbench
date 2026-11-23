import { z } from 'zod';
import { FACINGS } from '../orientation';
import type { CellBox, Connector, PartDef } from '../parts/types';
import {
  CONNECTOR_KINDS,
  MAX_ALIASES,
  MAX_CONNECTORS,
  MAX_SIDE_STUDS,
  MAX_SOLIDS,
  READABLE_INDEX_VERSIONS,
  type ConnectorEntry,
  type LDrawIndex,
  type LDrawIndexEntry,
  type SolidBox,
} from './format';

/** Prefix that marks library parts in model files, e.g. "ldraw:3001". */
export const LDRAW_PREFIX = 'ldraw:';

const size = z.number().int().min(1).max(256);
const cell = z.number().int().min(0).max(1023);
/** An LDraw part number as the library writes it: lower case, as in "3001" or "3040b". */
const partNumber = z.string().regex(/^[0-9a-z_-]{1,40}$/);
/** How far a part's studs sit off the grid: not at all, or half a stud. */
const studOffset = z.union([z.literal(0), z.literal(0.5)]);

/** A box that holds at least one cell and stays inside the part's own box. */
function fitsPart([x0, y0, z0, x1, y1, z1]: SolidBox, { w, d, h }: { readonly w: number; readonly d: number; readonly h: number }): boolean {
  return x0 < x1 && x1 <= w && y0 < y1 && y1 <= h && z0 < z1 && z1 <= d;
}

/** Whether `alike` names, for each of `count` connections, the first of those alike with it: one no later than itself, and first of its own. */
function isAlikeOf(alike: readonly number[], count: number): boolean {
  return alike.length === count && alike.every((first, index) => first <= index && alike[first] === first);
}

const finite = z.number().finite();
/** A connection: its kind, middle, unit axis (to within rounding) and length (see ConnectorEntry). */
const connector = z
  .tuple([z.number().int().min(0).max(CONNECTOR_KINDS.length - 1), finite, finite, finite, finite, finite, finite, finite.positive().max(1000)])
  .refine(([, , , , ax, ay, az]) => Math.abs(Math.hypot(ax, ay, az) - 1) < 0.01, { message: 'a connection runs along no axis' });

const entrySchema = z
  .object({
    id: partNumber,
    name: z.string().min(1).max(200),
    category: z.string().max(60),
    keywords: z.array(z.string().max(80)).max(40).optional(),
    author: z.string().max(120).optional(),
    w: size,
    d: size,
    h: z.number().int().min(1).max(1023),
    origin: z.tuple([z.number(), z.number(), z.number()]),
    snug: z.boolean(),
    solids: z.array(z.tuple([cell, cell, cell, cell, cell, cell])).min(1).max(MAX_SOLIDS).optional(),
    printed: z.literal(true).optional(),
    base: partNumber.optional(),
    studOffset: z.tuple([studOffset, studOffset]).optional(),
    sideStuds: z
      .array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().int().min(1).max(FACINGS.length - 1)]))
      .max(MAX_SIDE_STUDS)
      .optional(),
    connectors: z.array(connector).max(MAX_CONNECTORS).optional(),
    alike: z.array(z.number().int().min(0).max(MAX_CONNECTORS - 1)).max(MAX_CONNECTORS).optional(),
    extent: z
      .tuple([finite, finite, finite, finite, finite, finite])
      .refine(([x0, y0, z0, x1, y1, z1]) => x0 <= x1 && y0 <= y1 && z0 <= z1, { message: 'a part’s extent is inside out' })
      .optional(),
  })
  .refine((entry) => (entry.solids ?? []).every((box) => fitsPart(box, entry)), {
    message: 'a part fills cells outside its own box',
    path: ['solids'],
  })
  .refine((entry) => entry.alike === undefined || isAlikeOf(entry.alike, entry.connectors?.length ?? 0), {
    message: 'a part’s alike connections do not match its connections',
    path: ['alike'],
  });

const indexSchema = z.object({
  version: z.literal([...READABLE_INDEX_VERSIONS]),
  generated: z.string(),
  parts: z.array(entrySchema).max(50_000),
  aliases: z.array(z.tuple([partNumber, partNumber])).max(MAX_ALIASES).optional(),
});

/** Validates a downloaded library index. */
export function parseLDrawIndex(raw: unknown): LDrawIndex {
  const parsed = indexSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The LDraw library index is damaged (${parsed.error.issues[0]?.message ?? 'unknown problem'}).`);
  return parsed.data;
}

export function isLDrawPartId(partId: string): boolean {
  return partId.startsWith(LDRAW_PREFIX);
}

const toCellBox = ([x0, y0, z0, x1, y1, z1]: SolidBox): CellBox => ({ x0, y0, z0, x1, y1, z1 });

/** A connection as the editor uses it, its axis made exactly unit again after rounding. */
function toConnector([kind, x, y, z, ax, ay, az, length]: ConnectorEntry): Connector {
  const size = Math.hypot(ax, ay, az);
  return { kind: CONNECTOR_KINDS[kind] ?? 'pinhole', at: { x, y, z }, axis: { x: ax / size, y: ay / size, z: az / size }, length };
}

/** A library part as the editor sees it: the cells it fills (its whole box unless the index says less), drawn from its own mesh. */
export function toPartDef(entry: LDrawIndexEntry): PartDef {
  return {
    id: `${LDRAW_PREFIX}${entry.id}`,
    name: entry.name,
    category: 'library',
    w: entry.w,
    d: entry.d,
    h: entry.h,
    studs: [],
    solids: entry.solids?.map(toCellBox) ?? [{ x0: 0, y0: 0, z0: 0, x1: entry.w, y1: entry.h, z1: entry.d }],
    shape: { kind: 'mesh' },
    ldraw: { file: `${entry.id}.dat`, origin: entry.origin },
    keywords: [entry.category.toLowerCase(), ...(entry.keywords ?? [])],
    ...(entry.printed ? { printed: true } : {}),
    ...(entry.studOffset ? { studOffset: entry.studOffset } : {}),
    ...(entry.sideStuds ? { sideStuds: entry.sideStuds.map(([x, y, z, facing]) => ({ at: { x, y, z }, facing: FACINGS[facing] ?? '-y' })) } : {}),
    ...(entry.connectors ? { connectors: entry.connectors.map(toConnector) } : {}),
    ...(entry.alike ? { alike: entry.alike } : {}),
    ...(entry.extent ? { extent: { min: { x: entry.extent[0], y: entry.extent[1], z: entry.extent[2] }, max: { x: entry.extent[3], y: entry.extent[4], z: entry.extent[5] } } } : {}),
  };
}
