import { z } from 'zod';
import type { PartDef } from '../parts/types';
import { LDRAW_INDEX_VERSION, type LDrawIndex, type LDrawIndexEntry } from './format';

/** Prefix that marks library parts in model files, e.g. "ldraw:3001". */
export const LDRAW_PREFIX = 'ldraw:';

const size = z.number().int().min(1).max(256);

const entrySchema = z.object({
  id: z.string().regex(/^[0-9a-z_-]{1,40}$/),
  name: z.string().min(1).max(200),
  category: z.string().max(60),
  keywords: z.array(z.string().max(80)).max(40).optional(),
  author: z.string().max(120).optional(),
  w: size,
  d: size,
  h: z.number().int().min(1).max(1023),
  origin: z.tuple([z.number(), z.number(), z.number()]),
  snug: z.boolean(),
});

const indexSchema = z.object({
  version: z.literal(LDRAW_INDEX_VERSION),
  generated: z.string(),
  parts: z.array(entrySchema).max(50_000),
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

/** A library part as the editor sees it: a box of cells it fills, drawn from its own mesh. */
export function toPartDef(entry: LDrawIndexEntry): PartDef {
  return {
    id: `${LDRAW_PREFIX}${entry.id}`,
    name: entry.name,
    category: 'library',
    w: entry.w,
    d: entry.d,
    h: entry.h,
    studs: [],
    solids: [{ x0: 0, y0: 0, z0: 0, x1: entry.w, y1: entry.h, z1: entry.d }],
    shape: { kind: 'mesh' },
    ldraw: { file: `${entry.id}.dat`, origin: entry.origin },
    keywords: [entry.category.toLowerCase(), ...(entry.keywords ?? [])],
  };
}
