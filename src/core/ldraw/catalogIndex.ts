import { z } from 'zod';
import type { CellBox, PartDef } from '../parts/types';
import { MAX_ALIASES, MAX_SOLIDS, READABLE_INDEX_VERSIONS, type LDrawIndex, type LDrawIndexEntry, type SolidBox } from './format';

/** Prefix that marks library parts in model files, e.g. "ldraw:3001". */
export const LDRAW_PREFIX = 'ldraw:';

const size = z.number().int().min(1).max(256);
const cell = z.number().int().min(0).max(1023);
/** An LDraw part number as the library writes it: lower case, as in "3001" or "3040b". */
const partNumber = z.string().regex(/^[0-9a-z_-]{1,40}$/);

/** A box that holds at least one cell and stays inside the part's own box. */
function fitsPart([x0, y0, z0, x1, y1, z1]: SolidBox, { w, d, h }: { readonly w: number; readonly d: number; readonly h: number }): boolean {
  return x0 < x1 && x1 <= w && y0 < y1 && y1 <= h && z0 < z1 && z1 <= d;
}

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
  })
  .refine((entry) => (entry.solids ?? []).every((box) => fitsPart(box, entry)), {
    message: 'a part fills cells outside its own box',
    path: ['solids'],
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
  };
}
