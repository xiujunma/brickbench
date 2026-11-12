import { useMemo, useState } from 'react';
import { PARTS, PART_CATEGORIES, searchParts } from '../../core/parts/catalog';
import type { PartCategory } from '../../core/parts/types';
import { useEditor } from '../../state/editorStore';
import { useLibrary } from '../../state/library';
import { Icon } from '../components/Icon';
import { LibraryBrowser } from './LibraryBrowser';
import { PartTile } from './PartTile';

type Filter = PartCategory | 'all';
type Source = 'basic' | 'library';

type ListProps = {
  readonly colorId: number;
  /** The part being built with, if any, so its tile can show as picked. */
  readonly activePartId: string | null;
  readonly onPick: (partId: string) => void;
};

function BasicParts({ colorId, activePartId, onPick }: ListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('bricks');
  const searching = query.trim().length > 0;
  const parts = useMemo(
    () => searchParts(query, searching || filter === 'all' ? undefined : filter),
    [query, searching, filter],
  );

  return (
    <>
      <label className="search">
        <Icon name="search" size={16} />
        <span className="visually-hidden">Search parts</span>
        <input
          id="part-search"
          type="search"
          placeholder="Search: 2x4, slope, 3001…"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
        />
        <kbd>/</kbd>
      </label>
      <div className="chips" role="tablist" aria-label="Part categories">
        {[{ id: 'all' as const, label: 'All' }, ...PART_CATEGORIES].map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            className="chip"
            aria-selected={!searching && filter === category.id}
            onClick={() => {
              setFilter(category.id);
              setQuery('');
            }}
          >
            {category.label}
          </button>
        ))}
      </div>
      {searching && <p className="part-results-note">{parts.length} matches across all categories</p>}
      <div className="part-grid" role="list">
        {parts.map((part) => (
          <PartTile key={part.id} part={part} colorId={colorId} isActive={part.id === activePartId} onPick={onPick} />
        ))}
        {parts.length === 0 && <p className="empty-note">No parts match “{query}”.</p>}
      </div>
    </>
  );
}

type Props = {
  /** Called after a part is picked, e.g. to close the drawer on small screens. */
  readonly onPicked?: () => void;
};

export function PartsPanel({ onPicked }: Props) {
  const [source, setSource] = useState<Source>('basic');
  const activePartId = useEditor((s) => (s.tool === 'build' && s.pastePayload === null ? s.activePartId : null));
  const colorId = useEditor((s) => s.activeColorId);
  const setActivePart = useEditor((s) => s.setActivePart);
  const libraryCount = useLibrary((s) => s.entries.length);
  const pick = (partId: string) => {
    setActivePart(partId);
    onPicked?.();
  };
  const count = source === 'basic' ? PARTS.length : libraryCount;
  const list = { colorId, activePartId, onPick: pick };

  return (
    <aside className="panel panel-parts" aria-label="Parts library">
      <div className="panel-head">
        <h2>Parts</h2>
        {count > 0 && <span className="count">{count.toLocaleString('en')} parts</span>}
      </div>
      <div className="segmented source-switch" role="group" aria-label="Part source">
        <button type="button" aria-pressed={source === 'basic'} onClick={() => setSource('basic')}>
          Basic
        </button>
        <button type="button" aria-pressed={source === 'library'} onClick={() => setSource('library')}>
          LDraw library
        </button>
      </div>
      {source === 'basic' ? <BasicParts {...list} /> : <LibraryBrowser {...list} />}
    </aside>
  );
}
