import { useDeferredValue, useEffect, useMemo, useReducer, type Dispatch } from 'react';
import { colourInQuery } from '../../../core/parts/finder/colourWords';
import type { Finder, FinderItem, FinderResult } from '../../../core/parts/finder/finder';
import {
  FRESH_SESSION,
  finderSession,
  isSearching,
  type FinderSessionAction,
  type FinderSessionState,
} from '../../../state/finderSession';

export interface FinderSession extends FinderSessionState {
  /** The words the results show, without a colour: a moment behind while typing runs ahead. */
  readonly shownQuery: string;
  /** A palette colour named in the query ("red 2x4 brick"): tiles show it and picks build in it. */
  readonly colorId: number | null;
  /** Results to show, or null when not searching. */
  readonly result: FinderResult | null;
  readonly dispatch: Dispatch<FinderSessionAction>;
  /** Moves the highlight through the results for what is typed now. */
  readonly move: (step: 1 | -1) => void;
  /** The part Enter builds with now; none unless searching. */
  readonly chosen: () => FinderItem | undefined;
}

/**
 * The search box's state: words, filters, highlight and paging, with results
 * that keep typing responsive. `owned` holds the parts the user owns, for the
 * Owned filter; without parts lists the filter has nothing to keep to.
 */
export function useFinderSession(finder: Finder, owned: ReadonlySet<string> | null = null): FinderSession {
  const [state, dispatch] = useReducer(finderSession, FRESH_SESSION);
  const { query, highlighted } = state;
  const filters = useMemo(() => (owned ? state.filters : { ...state.filters, owned: undefined }), [owned, state.filters]);
  // once the last list goes, so does the filter: adding a list later starts unfiltered
  useEffect(() => {
    if (!owned && state.filters.owned) dispatch({ type: 'filters', filters: { ...state.filters, owned: undefined } });
  }, [owned, state.filters]);
  const finderFilters = useMemo(() => (filters.owned && owned ? { ...filters, only: owned } : filters), [filters, owned]);
  const live = useMemo(() => colourInQuery(query), [query]);
  const shown = colourInQuery(useDeferredValue(query));
  const result = useMemo(
    () => (isSearching(shown.rest, filters) ? finder.find(shown.rest, finderFilters) : null),
    [finder, shown.rest, filters, finderFilters],
  );

  // the keys act on what is typed now: the list on screen may still be catching up
  const liveItems = (): readonly FinderItem[] => {
    if (!isSearching(live.rest, filters)) return [];
    return live.rest === shown.rest && result ? result.items : finder.find(live.rest, finderFilters).items;
  };

  return {
    ...state,
    filters,
    shownQuery: shown.rest,
    colorId: live.colorId,
    result,
    dispatch,
    move: (step) => dispatch({ type: 'move', step, count: liveItems().length }),
    chosen: () => {
      const items = liveItems();
      return items[Math.min(highlighted, items.length - 1)];
    },
  };
}
