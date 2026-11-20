import { getColor } from '../../core/colors';
import type { Brick } from '../../core/model/types';
import { getPart } from '../../core/parts/catalog';

export interface SummaryRow {
  readonly key: string;
  readonly name: string;
  readonly hex: string;
  readonly count: number;
}

/** Bricks counted by part and colour, the most numerous first, at most `limit` rows. */
export function summarize(bricks: readonly Brick[], limit: number): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  for (const brick of bricks) {
    const key = `${brick.partId}|${brick.colorId}`;
    const row = rows.get(key);
    rows.set(key, {
      key,
      name: getPart(brick.partId)?.name ?? brick.partId,
      hex: getColor(brick.colorId)?.hex ?? '#999999',
      count: (row?.count ?? 0) + 1,
    });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
