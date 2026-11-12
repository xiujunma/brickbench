import { describe, expect, it } from 'bun:test';
import { FRESH_SESSION, finderSession, hasFilters, isSearching, PAGE, type FinderSessionState } from './finderSession';

const typed = (query: string): FinderSessionState => finderSession(FRESH_SESSION, { type: 'query', query });

describe('finder session', () => {
  it('searches only with words typed or a filter set', () => {
    expect(isSearching('', {})).toBe(false);
    expect(isSearching('   ', {})).toBe(false);
    expect(isSearching('2x4', {})).toBe(true);
    expect(isSearching('', { height: 'plate' })).toBe(true);
    // punctuation alone names nothing
    expect(isSearching('?', {})).toBe(false);
    expect(isSearching('“”', {})).toBe(false);
    expect(hasFilters({ footprint: undefined })).toBe(false);
  });

  it('starts each new search at the first result and the first page', () => {
    const browsed = finderSession(finderSession(typed('plate'), { type: 'move', step: 1, count: 5 }), { type: 'more' });
    expect(browsed).toMatchObject({ highlighted: 1, limit: 2 * PAGE });
    expect(finderSession(browsed, { type: 'query', query: 'plates' })).toMatchObject({ query: 'plates', highlighted: 0, limit: PAGE });
    const filtered = finderSession(browsed, { type: 'filters', filters: { feature: 'clip' } });
    expect(filtered).toMatchObject({ query: 'plate', filters: { feature: 'clip' }, highlighted: 0, limit: PAGE });
  });

  it('moves the highlight within the results', () => {
    const down = finderSession(typed('brick'), { type: 'move', step: 1, count: 3 });
    expect(down.highlighted).toBe(1);
    const up = finderSession(finderSession(down, { type: 'move', step: -1, count: 3 }), { type: 'move', step: -1, count: 3 });
    expect(up.highlighted).toBe(0);
    const last = { ...typed('brick'), highlighted: 2 };
    expect(finderSession(last, { type: 'move', step: 1, count: 3 })).toBe(last);
    // nothing to move through
    expect(finderSession(FRESH_SESSION, { type: 'move', step: 1, count: 0 })).toBe(FRESH_SESSION);
  });

  it('shows the next page when the highlight runs off this one', () => {
    const edge = { ...typed('plate'), highlighted: PAGE - 1 };
    expect(finderSession(edge, { type: 'move', step: 1, count: PAGE + 10 })).toMatchObject({ highlighted: PAGE, limit: 2 * PAGE });
  });

  it('clears words, filters, highlight and paging together', () => {
    const busy = { query: 'clip', filters: { footprint: '1x1' }, highlighted: 4, limit: 3 * PAGE };
    expect(finderSession(busy, { type: 'clear' })).toEqual(FRESH_SESSION);
  });
});
