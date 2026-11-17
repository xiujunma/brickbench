import type { Feature, HeightClass } from '../core/parts/finder/tags';
import { normalizeForSearch } from '../core/parts/finder/text';

/** Tiles shown at first and added by each "Show more"; every tile draws a thumbnail. */
export const PAGE = 60;

/** The quick filters over the search box. */
export interface PartFilters {
  readonly footprint?: string | undefined;
  readonly height?: HeightClass | undefined;
  readonly feature?: Feature | undefined;
  /** Only parts the user owns, from the parts lists of their sets. */
  readonly owned?: boolean | undefined;
}

export const NO_FILTERS: PartFilters = {};

export function hasFilters(filters: PartFilters): boolean {
  return Boolean(filters.footprint || filters.height || filters.feature || filters.owned);
}

/** Searching means words typed or a filter set; otherwise the panel shows its browsing views. Punctuation alone is no words. */
export function isSearching(query: string, filters: PartFilters): boolean {
  return normalizeForSearch(query) !== '' || hasFilters(filters);
}

export interface FinderSessionState {
  readonly query: string;
  readonly filters: PartFilters;
  /** The result Enter builds with. */
  readonly highlighted: number;
  /** How many results are shown. */
  readonly limit: number;
}

export type FinderSessionAction =
  | { readonly type: 'query'; readonly query: string }
  | { readonly type: 'filters'; readonly filters: PartFilters }
  /** `count`: how many results there are for what is typed now. */
  | { readonly type: 'move'; readonly step: 1 | -1; readonly count: number }
  | { readonly type: 'more' }
  | { readonly type: 'clear' };

export const FRESH_SESSION: FinderSessionState = { query: '', filters: NO_FILTERS, highlighted: 0, limit: PAGE };

function moved(state: FinderSessionState, step: 1 | -1, count: number): FinderSessionState {
  const highlighted = Math.min(Math.max(state.highlighted + step, 0), Math.max(count - 1, 0));
  if (highlighted === state.highlighted) return state;
  // running off the shown page brings in the next one
  const limit = highlighted >= state.limit ? state.limit + PAGE : state.limit;
  return { ...state, highlighted, limit };
}

/** What the search box, filters and arrow keys do to a search. */
export function finderSession(state: FinderSessionState, action: FinderSessionAction): FinderSessionState {
  switch (action.type) {
    case 'query':
      return { ...state, query: action.query, highlighted: 0, limit: PAGE };
    case 'filters':
      return { ...state, filters: action.filters, highlighted: 0, limit: PAGE };
    case 'move':
      return moved(state, action.step, action.count);
    case 'more':
      return { ...state, limit: state.limit + PAGE };
    case 'clear':
      return FRESH_SESSION;
  }
}
