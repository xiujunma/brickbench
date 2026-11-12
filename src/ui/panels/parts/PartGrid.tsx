import { useMemo, useState, type ReactNode } from 'react';
import type { FinderItem } from '../../../core/parts/finder/finder';
import { getPart } from '../../../core/parts/catalog';
import { PAGE } from '../../../state/finderSession';
import { partPicks, usePartPicks } from '../../../state/partPicks';
import { PartTile } from './PartTile';

/** What every list of parts needs to draw and pick its tiles. */
export type TileContext = {
  readonly colorId: number;
  /** The part being built with, if any, so its tile can show as picked. */
  readonly activePartId: string | null;
  readonly onPick: (partId: string) => void;
};

export const tileId = (index: number): string => `part-result-${index}`;

type Props = TileContext & {
  readonly items: readonly FinderItem[];
  /** Index picked by Enter in the search box; only search results have one. */
  readonly highlighted?: number;
  readonly limit?: number;
  readonly onMore?: () => void;
  readonly badges?: ReadonlyMap<string, string> | undefined;
  /** Shown instead of the grid when there are no items. */
  readonly empty?: ReactNode;
  readonly label: string;
};

/** A grid of part tiles, a page at a time. The list holds tiles only; notes and buttons sit outside it. */
export function PartGrid({ items, highlighted, limit = PAGE, onMore, badges, empty, label, ...tile }: Props) {
  const favourites = usePartPicks((s) => s.favourites);
  const starred = useMemo(() => new Set(favourites), [favourites]);
  if (items.length === 0) return <>{empty}</>;
  const remaining = items.length - limit;
  return (
    <>
      <div className="part-grid" role="list" aria-label={label}>
        {items.slice(0, limit).map((item, index) => {
          const part = getPart(item.partId);
          if (!part) return null;
          return (
            <PartTile
              key={item.partId}
              id={highlighted === undefined ? undefined : tileId(index)}
              part={part}
              colorId={tile.colorId}
              isActive={part.id === tile.activePartId}
              onPick={tile.onPick}
              isStarred={starred.has(part.id)}
              onStar={partPicks.toggleFavourite}
              isHighlighted={index === highlighted}
              credit={item.author ? `by ${item.author}` : undefined}
              badge={badges?.get(item.partId)}
            />
          );
        })}
      </div>
      {remaining > 0 && onMore && (
        <div className="show-more-row">
          <button type="button" className="btn btn-outline" onClick={onMore}>
            Show {Math.min(PAGE, remaining)} more
          </button>
        </div>
      )}
    </>
  );
}

/** Paging state for a grid: starts at one page, grows by one per "Show more". */
export function usePaging(): readonly [number, () => void, () => void] {
  const [limit, setLimit] = useState(PAGE);
  return [limit, () => setLimit((n) => n + PAGE), () => setLimit(PAGE)] as const;
}
