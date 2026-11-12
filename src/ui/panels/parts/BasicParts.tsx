import { useMemo, useState } from 'react';
import { PART_CATEGORIES } from '../../../core/parts/catalog';
import type { Finder } from '../../../core/parts/finder/finder';
import type { PartCategory } from '../../../core/parts/types';
import { PartGrid, type TileContext } from './PartGrid';

type Filter = PartCategory | 'all';
type Props = TileContext & { readonly finder: Finder };

/** The built-in parts, by category. */
export function BasicParts({ finder, ...tile }: Props) {
  const [category, setCategory] = useState<Filter>('bricks');
  const items = useMemo(
    () => finder.find('', { source: 'basic', category: category === 'all' ? undefined : category }).items,
    [finder, category],
  );
  return (
    <>
      <div className="chips" role="tablist" aria-label="Part categories">
        {[{ id: 'all' as const, label: 'All' }, ...PART_CATEGORIES].map((c) => (
          <button key={c.id} type="button" role="tab" className="chip" aria-selected={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="part-scroll">
        <PartGrid label="Basic parts" items={items} limit={Number.POSITIVE_INFINITY} {...tile} />
      </div>
    </>
  );
}
