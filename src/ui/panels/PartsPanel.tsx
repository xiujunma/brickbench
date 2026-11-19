import { useEffect, useMemo, useRef, useState } from 'react';
import { getColor } from '../../core/colors';
import { useEditor } from '../../state/editorStore';
import { hasFilters } from '../../state/finderSession';
import { FilterBar } from './parts/FilterBar';
import { FinderSearch } from './parts/FinderSearch';
import { FindResults } from './parts/FindResults';
import { tileId, type TileContext } from './parts/PartGrid';
import { initialSource, PartSources, type PartSource } from './parts/PartSources';
import { useFinder } from './parts/useFinder';
import { useFinderSession, type FinderSession } from './parts/useFinderSession';
import { useOwnedPartIds } from '../useStock';

/** Footprints offered in the size filter: those at least this many parts have. */
const FOOTPRINT_MINIMUM = 5;

type Props = {
  /** Called after a part is picked, e.g. to close the drawer on small screens. */
  readonly onPicked?: () => void;
};

/**
 * Picking a part from the panel, by click or Enter. A colour named in the
 * search ("red 2x4 brick") shows on the tiles and is built in.
 */
function usePicking(session: FinderSession, onPicked: (() => void) | undefined) {
  const activePartId = useEditor((s) => (s.tool === 'build' && s.pastePayload === null ? s.activePartId : null));
  const activeColorId = useEditor((s) => s.activeColorId);
  const setActiveColor = useEditor((s) => s.setActiveColor);
  const setActivePart = useEditor((s) => s.setActivePart);
  const queryColorId = session.colorId;
  const pick = (partId: string): void => {
    if (queryColorId !== null) setActiveColor(queryColorId);
    setActivePart(partId);
    onPicked?.();
  };
  const tile: TileContext = { colorId: queryColorId ?? activeColorId, activePartId, onPick: pick };
  const buildWithChosen = (): boolean => {
    const item = session.chosen();
    if (item) {
      pick(item.partId);
      return true;
    }
    // just a colour typed: Enter picks the colour
    if (queryColorId === null) return false;
    setActiveColor(queryColorId);
    session.dispatch({ type: 'clear' });
    return true;
  };
  const colourName = queryColorId === null ? null : (getColor(queryColorId)?.name ?? null);
  return { tile, buildWithChosen, colourName };
}

export function PartsPanel({ onPicked }: Props) {
  const finder = useFinder();
  const owned = useOwnedPartIds();
  const openDialog = useEditor((s) => s.openDialog);
  const session = useFinderSession(finder, owned);
  const { result, highlighted, dispatch } = session;
  const searchRef = useRef<HTMLInputElement>(null);
  const { tile, buildWithChosen, colourName } = usePicking(session, onPicked);
  const [source, setSource] = useState<PartSource>(initialSource);
  const footprints = useMemo(() => finder.footprints(FOOTPRINT_MINIMUM), [finder]);
  const searching = result !== null;

  // a new list (or a new highlight) brings the highlighted tile into view
  useEffect(() => {
    if (searching) document.getElementById(tileId(highlighted))?.scrollIntoView({ block: 'nearest' });
  }, [searching, result, highlighted]);

  const clear = (): boolean => {
    const hadAnything = session.query !== '' || hasFilters(session.filters);
    dispatch({ type: 'clear' });
    return hadAnything;
  };

  return (
    <aside className="panel panel-parts" aria-label="Parts library">
      <div className="panel-head">
        <h2>Parts</h2>
        <span className="count">{finder.count.toLocaleString('en')} parts</span>
      </div>
      <FinderSearch
        inputRef={searchRef}
        query={session.query}
        onQuery={(query) => dispatch({ type: 'query', query })}
        onMove={session.move}
        onEnter={buildWithChosen}
        onEscape={clear}
      />
      <FilterBar filters={session.filters} footprints={footprints} ownable={owned !== null} onChange={(filters) => dispatch({ type: 'filters', filters })} />
      {result ? (
        <FindResults
          {...tile}
          result={result}
          query={session.shownQuery}
          patternError={session.patternError}
          colourName={colourName}
          highlighted={highlighted}
          limit={session.limit}
          onMore={() => dispatch({ type: 'more' })}
          onClear={() => {
            clear();
            // the button goes with the results: keep the keyboard in the search box
            searchRef.current?.focus();
          }}
        />
      ) : (
        <PartSources finder={finder} source={source} onSource={setSource} {...tile} />
      )}
      <footer className="panel-footer">
        <span>Not made or endorsed by the LEGO Group</span>
        <button type="button" className="link-button" onClick={() => openDialog('about')}>
          About & privacy
        </button>
      </footer>
    </aside>
  );
}
