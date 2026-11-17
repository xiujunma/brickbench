import { useMemo } from 'react';
import { partNumberOf } from '../core/inventory/match';
import { ownedCounts, partIdFor, stockOf, usedCounts, type Counts, type Stock } from '../core/inventory/stock';
import { LDRAW_PREFIX } from '../core/ldraw/catalogIndex';
import { getPart } from '../core/parts/catalog';
import { useEditor } from '../state/editorStore';
import { useInventory } from '../state/inventory';
import { bricksOf } from '../state/selectors';

export interface StockView {
  /** Whether the user has added any parts lists. */
  readonly active: boolean;
  readonly owned: Counts;
  readonly used: Counts;
  /** How many of a part in a colour the user has, uses and has left; null when they own none. */
  of(partId: string, colorId: number): Stock | null;
}

const NONE: Counts = new Map();

/** The user's parts set against the model; it follows the model only once there are lists to count. */
export function useStock(): StockView {
  const lists = useInventory((s) => s.lists);
  const active = lists.length > 0;
  const model = useEditor((s) => (active ? s.history.present : null));
  const owned = useMemo(() => (active ? ownedCounts(lists) : NONE), [active, lists]);
  const used = useMemo(() => (model ? usedCounts(bricksOf(model), getPart) : NONE), [model]);
  return useMemo(
    () => ({
      active,
      owned,
      used,
      of: (partId: string, colorId: number): Stock | null => {
        const number = partNumberOf(getPart(partId));
        if (!number) return null;
        const stock = stockOf(owned, used, number, colorId);
        return stock.owned > 0 ? stock : null;
      },
    }),
    [active, owned, used],
  );
}

/** "3 left", or "2 over" when the model uses more than the user has. */
export function stockBadge(stock: Stock | null): string | undefined {
  if (!stock) return undefined;
  return stock.left >= 0 ? `${stock.left} left` : `${-stock.left} over`;
}

/** Every part id that builds with a part the user owns, the library twins of basic parts included; null without lists. */
export function useOwnedPartIds(): ReadonlySet<string> | null {
  const lists = useInventory((s) => s.lists);
  return useMemo(() => {
    if (lists.length === 0) return null;
    const ids = new Set<string>();
    for (const list of lists) {
      for (const lot of list.lots) {
        ids.add(partIdFor(lot.part));
        ids.add(`${LDRAW_PREFIX}${lot.part}`);
      }
    }
    return ids;
  }, [lists]);
}
