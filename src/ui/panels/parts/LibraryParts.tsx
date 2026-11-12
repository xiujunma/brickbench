import { useEffect, useMemo, useState } from 'react';
import type { CategoryCount } from '../../../core/ldraw/categories';
import type { Finder } from '../../../core/parts/finder/finder';
import { partLibrary, useLibrary } from '../../../state/library';
import { LibraryCredit } from './LibraryCredit';
import { PartGrid, usePaging, type TileContext } from './PartGrid';

const DEFAULT_CATEGORY = 'Brick';

type Props = TileContext & { readonly finder: Finder };

type PickerProps = {
  readonly category: string | null;
  readonly categories: readonly CategoryCount[];
  readonly total: number;
  readonly onChange: (category: string | null) => void;
};

function CategoryPicker({ category, categories, total, onChange }: PickerProps) {
  return (
    <div className="library-filter">
      <label className="visually-hidden" htmlFor="library-category">
        Category
      </label>
      <select id="library-category" className="select" value={category ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">All categories ({total.toLocaleString('en')})</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count.toLocaleString('en')})
          </option>
        ))}
      </select>
    </div>
  );
}

function LibraryCategories({ finder, ...tile }: Props) {
  const categories = useLibrary((s) => s.categories);
  const total = useLibrary((s) => s.entries.length);
  const [category, setCategory] = useState<string | null>(() => (categories.some((c) => c.name === DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : null));
  const [limit, showMore, resetLimit] = usePaging();
  const items = useMemo(() => finder.find('', { source: 'library', category: category ?? undefined }).items, [finder, category]);
  return (
    <>
      <CategoryPicker
        category={category}
        categories={categories}
        total={total}
        onChange={(next) => {
          setCategory(next);
          resetLimit();
        }}
      />
      <p className="part-results-note" role="status">
        {items.length.toLocaleString('en')} parts
      </p>
      <div className="part-scroll">
        <PartGrid label="LDraw library parts" items={items} limit={limit} onMore={showMore} {...tile} />
      </div>
      <LibraryCredit />
    </>
  );
}

/** Browses the LDraw library by category, loading its index on first view. */
export function LibraryParts(props: Props) {
  const status = useLibrary((s) => s.status);
  const error = useLibrary((s) => s.error);

  useEffect(() => {
    partLibrary.request();
  }, []);

  if (status === 'ready') return <LibraryCategories {...props} />;
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
          onClick={() => partLibrary.retry()}
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
