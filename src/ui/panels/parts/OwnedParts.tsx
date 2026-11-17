import { useEffect, useId, useMemo } from 'react';
import { COLORS } from '../../../core/colors';
import { partIdFor, type Stock } from '../../../core/inventory/stock';
import { getPart } from '../../../core/parts/catalog';
import type { PartDef } from '../../../core/parts/types';
import { editorStore, useEditor } from '../../../state/editorStore';
import { PAGE } from '../../../state/finderSession';
import { partLibrary, useLibrary } from '../../../state/library';
import { partPicks, usePartPicks } from '../../../state/partPicks';
import { stockBadge, useStock } from '../../useStock';
import { usePaging, type TileContext } from './PartGrid';
import { PartTile } from './PartTile';

interface OwnedLot {
  readonly key: string;
  readonly part: PartDef;
  readonly colorId: number;
  readonly stock: Stock;
}

const PALETTE_ORDER: ReadonlyMap<number, number> = new Map(COLORS.map((c, i) => [c.id, i]));

/** Every part and colour the user owns that BrickBench can draw, by name and then palette order. */
function useOwnedLots(): readonly OwnedLot[] {
  const stock = useStock();
  // library parts become known to getPart once the library has loaded: count them again then
  const libraryStatus = useLibrary((s) => s.status);
  return useMemo(() => {
    const lots: OwnedLot[] = [];
    for (const key of stock.owned.keys()) {
      const bar = key.lastIndexOf('|');
      const part = getPart(partIdFor(key.slice(0, bar)));
      const colorId = Number(key.slice(bar + 1));
      const lot = part ? stock.of(part.id, colorId) : null;
      if (part && lot) lots.push({ key, part, colorId, stock: lot });
    }
    const order = (id: number): number => PALETTE_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
    return lots.sort((a, b) => a.part.name.localeCompare(b.part.name, 'en', { numeric: true }) || order(a.colorId) - order(b.colorId));
  }, [stock, libraryStatus]);
}

type Props = Pick<TileContext, 'onPick'>;

/** The parts of the user's sets, each in its own colour with how many are left; picking one builds with it in that colour. */
export function OwnedParts({ onPick }: Props) {
  const headingId = useId();
  const lots = useOwnedLots();
  const [limit, showMore] = usePaging();
  const favourites = usePartPicks((s) => s.favourites);
  const starred = useMemo(() => new Set(favourites), [favourites]);
  const active = useEditor((s) => (s.tool === 'build' && s.pastePayload === null ? `${s.activePartId}|${s.activeColorId}` : null));
  const openDialog = useEditor((s) => s.openDialog);
  const libraryStatus = useLibrary((s) => s.status);

  useEffect(() => partLibrary.request(), []);

  const pick = (lot: OwnedLot): void => {
    const state = editorStore.getState();
    // so the colour does not repaint whatever was selected
    if (state.selection.size > 0) state.clearSelection();
    state.setActiveColor(lot.colorId);
    onPick(lot.part.id);
  };

  const remaining = lots.length - limit;
  const waiting = libraryStatus === 'idle' || libraryStatus === 'loading';
  return (
    <section className="part-section owned-parts" aria-labelledby={headingId}>
      <div className="part-section-head">
        <h3 id={headingId}>Parts you own</h3>
        <button type="button" className="link-button" onClick={() => openDialog('my-parts')}>
          Your sets
        </button>
      </div>
      {lots.length === 0 ? (
        <p className="empty-note" role="status">
          {waiting ? 'Loading your parts…' : 'Your parts are all LDraw library parts, and the library is not available.'}
        </p>
      ) : (
        <div className="part-grid" role="list" aria-label="Parts you own">
          {lots.slice(0, limit).map((lot) => (
            <PartTile
              key={lot.key}
              part={lot.part}
              colorId={lot.colorId}
              isActive={active === `${lot.part.id}|${lot.colorId}`}
              onPick={() => pick(lot)}
              isStarred={starred.has(lot.part.id)}
              onStar={partPicks.toggleFavourite}
              badge={stockBadge(lot.stock)}
              badgeAlert={lot.stock.left < 0}
            />
          ))}
        </div>
      )}
      {remaining > 0 && (
        <div className="show-more-row">
          <button type="button" className="btn btn-outline" onClick={showMore}>
            Show {Math.min(remaining, PAGE)} more
          </button>
        </div>
      )}
    </section>
  );
}

/** For anyone without lists yet: what they are for, and the way to add one. */
export function OwnedPartsPrompt() {
  const openDialog = useEditor((s) => s.openDialog);
  return (
    <p className="owned-prompt">
      Own some sets?{' '}
      <button type="button" className="link-button" onClick={() => openDialog('my-parts')}>
        Add their parts lists
      </button>{' '}
      and BrickBench counts what you have left as you build.
    </p>
  );
}
