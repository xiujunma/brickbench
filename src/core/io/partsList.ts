import { getColor } from '../colors';
import type { Brick } from '../model/types';
import { PARTS } from '../parts/catalog';
import type { PartLookup } from '../parts/types';

export interface PartsListRow {
  readonly partId: string;
  readonly partName: string;
  readonly ldraw: string | null;
  readonly colorId: number;
  readonly colorName: string;
  readonly colorHex: string;
  readonly quantity: number;
}

const CATALOG_ORDER: ReadonlyMap<string, number> = new Map(PARTS.map((p, i) => [p.id, i]));

/** Counts bricks per part and colour, ordered like the catalogue and then by quantity. */
export function buildPartsList(bricks: Iterable<Brick>, lookup: PartLookup): PartsListRow[] {
  const counts = new Map<string, { partId: string; colorId: number; quantity: number }>();
  for (const brick of bricks) {
    const key = `${brick.partId}|${brick.colorId}`;
    const entry = counts.get(key);
    counts.set(key, {
      partId: brick.partId,
      colorId: brick.colorId,
      quantity: (entry?.quantity ?? 0) + 1,
    });
  }

  const rows = [...counts.values()].map(({ partId, colorId, quantity }): PartsListRow => {
    const part = lookup(partId);
    const color = getColor(colorId);
    return {
      partId,
      partName: part?.name ?? partId,
      ldraw: part?.ldraw?.file.replace(/\.dat$/, '') ?? null,
      colorId,
      colorName: color?.name ?? `Colour ${colorId}`,
      colorHex: color?.hex ?? '#888888',
      quantity,
    };
  });

  const order = (id: string) => CATALOG_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
  return rows.sort(
    (a, b) =>
      order(a.partId) - order(b.partId) ||
      b.quantity - a.quantity ||
      a.colorName.localeCompare(b.colorName),
  );
}

/** Quotes a CSV cell and defuses text a spreadsheet would run as a formula. */
export function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function partsListCsv(rows: readonly PartsListRow[]): string {
  const header = ['Quantity', 'Part', 'LDraw ID', 'Colour', 'LDraw colour'].join(',');
  const lines = rows.map((row) =>
    [row.quantity, row.partName, row.ldraw ?? '', row.colorName, row.colorId].map(csvCell).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}
