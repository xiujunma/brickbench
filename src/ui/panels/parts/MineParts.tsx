import { useEffect, useId, useMemo } from 'react';
import { isLDrawPartId } from '../../../core/ldraw/catalogIndex';
import type { Finder, FinderItem } from '../../../core/parts/finder/finder';
import { useEditor } from '../../../state/editorStore';
import { partLibrary, useLibrary } from '../../../state/library';
import { usePartPicks } from '../../../state/partPicks';
import { bricksOf } from '../../../state/selectors';
import { LibraryNotice } from './LibraryNotice';
import { PartGrid, usePaging, type TileContext } from './PartGrid';

type Props = TileContext & { readonly finder: Finder };

type Section = {
  readonly title: string;
  readonly items: readonly FinderItem[];
  readonly badges?: ReadonlyMap<string, string> | undefined;
};

const EMPTY_NOTE = 'Parts you build with show up here: your recent picks, the parts in your model, and any you star with ☆.';

/** Parts the model uses, most used first, with how many. */
function useModelParts(): readonly { readonly partId: string; readonly count: number }[] {
  const model = useEditor((s) => s.history.present);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const brick of bricksOf(model)) counts.set(brick.partId, (counts.get(brick.partId) ?? 0) + 1);
    return [...counts].map(([partId, count]) => ({ partId, count })).sort((a, b) => b.count - a.count);
  }, [model]);
}

function itemsFor(finder: Finder, ids: readonly string[]): FinderItem[] {
  return ids.map((id) => finder.get(id)).filter((item): item is FinderItem => item !== undefined);
}

/** Favourites, recent picks and the model's parts, and whether any come from the library. */
function useMineSections(finder: Finder): { readonly sections: readonly Section[]; readonly needsLibrary: boolean } {
  const favourites = usePartPicks((s) => s.favourites);
  const recent = usePartPicks((s) => s.recent);
  const used = useModelParts();
  const needsLibrary = [...favourites, ...recent, ...used.map((u) => u.partId)].some(isLDrawPartId);
  const sections: Section[] = [
    { title: 'Favourites', items: itemsFor(finder, favourites) },
    { title: 'Recent', items: itemsFor(finder, recent) },
    {
      title: 'In this model',
      items: itemsFor(finder, used.map((u) => u.partId)),
      badges: new Map(used.map((u) => [u.partId, `×${u.count}`])),
    },
  ];
  return { sections: sections.filter((section) => section.items.length > 0), needsLibrary };
}

function MineSection({ title, items, badges, ...tile }: Section & TileContext) {
  const headingId = useId();
  const [limit, showMore] = usePaging();
  return (
    <section className="part-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <PartGrid label={title} items={items} badges={badges} limit={limit} onMore={showMore} {...tile} />
    </section>
  );
}

/** Your parts: favourites, recent picks and what the model already uses. */
export function MineParts({ finder, ...tile }: Props) {
  const { sections, needsLibrary } = useMineSections(finder);
  const libraryStatus = useLibrary((s) => s.status);
  const waiting = needsLibrary && (libraryStatus === 'idle' || libraryStatus === 'loading');

  useEffect(() => {
    if (needsLibrary) partLibrary.request();
  }, [needsLibrary]);

  // with library parts still loading or unavailable, "nothing here yet" would be wrong
  const emptyNote = !needsLibrary ? EMPTY_NOTE : waiting ? 'Loading your LDraw library parts…' : null;
  return (
    <>
      {needsLibrary && <LibraryNotice />}
      {sections.length === 0 && emptyNote && (
        <p className="empty-note" role="status">
          {emptyNote}
        </p>
      )}
      {sections.map((section) => (
        <MineSection key={section.title} {...section} {...tile} />
      ))}
    </>
  );
}
