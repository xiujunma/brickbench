import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { LDRAW_PREFIX } from '../../core/ldraw/catalogIndex';
import type { LDrawIndexEntry } from '../../core/ldraw/format';
import type { CategoryCount } from '../../core/ldraw/librarySearch';
import { getPart } from '../../core/parts/catalog';
import { partLibrary, useLibrary } from '../../state/library';
import { Icon } from '../components/Icon';
import { PartTile } from './PartTile';

/** Tiles shown at first and added by each "Show more"; every tile draws a thumbnail. */
const PAGE = 60;
const DEFAULT_CATEGORY = 'Brick';

type Props = {
  readonly colorId: number;
  /** The part being built with, if any, so its tile can show as picked. */
  readonly activePartId: string | null;
  readonly onPick: (partId: string) => void;
};

function LibraryTile({ entry, colorId, activePartId, onPick }: Props & { readonly entry: LDrawIndexEntry }) {
  const part = getPart(`${LDRAW_PREFIX}${entry.id}`);
  if (!part) return null;
  return (
    <PartTile
      part={part}
      colorId={colorId}
      isActive={part.id === activePartId}
      onPick={onPick}
      credit={entry.author ? `by ${entry.author}` : undefined}
    />
  );
}

function LibraryCredit() {
  return (
    <p className="library-credit">
      Parts from the{' '}
      <a href="https://library.ldraw.org" target="_blank" rel="noopener noreferrer">
        LDraw™ Parts Library
      </a>{' '}
      by its contributors, under CC BY 4.0.{' '}
      <a href={`${partLibrary.baseUrl}CREDITS.txt`} target="_blank" rel="noopener noreferrer">
        Credits
      </a>
    </p>
  );
}

type SearchProps = {
  readonly query: string;
  readonly total: string;
  readonly onChange: (query: string) => void;
};

function LibrarySearch({ query, total, onChange }: SearchProps) {
  return (
    <label className="search">
      <Icon name="search" size={16} />
      <span className="visually-hidden">Search the LDraw library</span>
      <input
        id="part-search"
        type="search"
        placeholder={`Search ${total} parts: hinge, 3001…`}
        value={query}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      />
      <kbd>/</kbd>
    </label>
  );
}

type CategoryProps = {
  readonly category: string | null;
  readonly categories: readonly CategoryCount[];
  readonly total: string;
  readonly onChange: (category: string | null) => void;
};

function CategoryPicker({ category, categories, total, onChange }: CategoryProps) {
  return (
    <div className="library-filter">
      <label className="visually-hidden" htmlFor="library-category">
        Category
      </label>
      <select id="library-category" className="select" value={category ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">All categories ({total})</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count.toLocaleString('en')})
          </option>
        ))}
      </select>
    </div>
  );
}

type ResultsProps = Props & {
  readonly results: readonly LDrawIndexEntry[];
  readonly limit: number;
  readonly query: string;
  readonly onMore: () => void;
};

function LibraryResults({ results, limit, query, onMore, ...tile }: ResultsProps) {
  const remaining = results.length - limit;
  return (
    <div className="part-grid" role="list">
      {results.slice(0, limit).map((entry) => (
        <LibraryTile key={entry.id} entry={entry} {...tile} />
      ))}
      {results.length === 0 && <p className="empty-note">No library parts match “{query}”.</p>}
      {remaining > 0 && (
        <button type="button" className="btn btn-outline show-more" onClick={onMore}>
          Show {Math.min(PAGE, remaining)} more
        </button>
      )}
    </div>
  );
}

function LibraryParts(props: Props) {
  const entries = useLibrary((s) => s.entries);
  const categories = useLibrary((s) => s.categories);
  const search = useLibrary((s) => s.search);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(() =>
    categories.some((c) => c.name === DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : null,
  );
  const [limit, setLimit] = useState(PAGE);
  // typing stays responsive while the grid catches up
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;
  const results = useMemo(() => search(deferredQuery, searching ? null : category), [search, deferredQuery, searching, category]);
  const total = entries.length.toLocaleString('en');
  const count = results.length.toLocaleString('en');

  return (
    <>
      <LibrarySearch
        query={query}
        total={total}
        onChange={(next) => {
          setQuery(next);
          setLimit(PAGE);
        }}
      />
      <CategoryPicker
        category={category}
        categories={categories}
        total={total}
        onChange={(next) => {
          setCategory(next);
          setQuery('');
          setLimit(PAGE);
        }}
      />
      <p className="part-results-note" role="status">
        {searching ? `${count} matches across all categories` : `${count} parts`}
      </p>
      <LibraryResults {...props} results={results} limit={limit} query={deferredQuery} onMore={() => setLimit((n) => n + PAGE)} />
      <LibraryCredit />
    </>
  );
}

/** Browses the shipped LDraw parts library, loading its index on first view. */
export function LibraryBrowser(props: Props) {
  const status = useLibrary((s) => s.status);
  const error = useLibrary((s) => s.error);

  useEffect(() => {
    void partLibrary.load();
  }, []);

  if (status === 'ready') return <LibraryParts {...props} />;
  if (status === 'missing') {
    return (
      <div className="library-note">
        <strong>The LDraw library is not installed.</strong>
        <span>
          This copy of BrickBench was built without it. Run <code>bun run ldraw</code> to download and convert it, then reload.
        </span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="library-note" role="alert">
        <strong>The LDraw library could not be loaded.</strong>
        <span>{error}</span>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            partLibrary.meshes.retryFailed();
            void partLibrary.load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <p className="library-note" role="status">
      Loading the LDraw parts library…
    </p>
  );
}
