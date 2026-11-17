import type { Finder } from '../../../core/parts/finder/finder';
import { editorStore } from '../../../state/editorStore';
import { inventory } from '../../../state/inventory';
import { partLibrary } from '../../../state/library';
import { partPicks } from '../../../state/partPicks';
import { BasicParts } from './BasicParts';
import { LibraryParts } from './LibraryParts';
import { MineParts } from './MineParts';
import type { TileContext } from './PartGrid';

export type PartSource = 'mine' | 'basic' | 'library';

/** The visible label is the button's name; the hint says more to those who hover. */
const SOURCES: readonly { readonly id: PartSource; readonly label: string; readonly hint: string }[] = [
  { id: 'mine', label: 'Mine', hint: 'Your favourites, recent picks, the parts in this model and the parts you own' },
  { id: 'basic', label: 'Basic', hint: 'The basic parts that come with BrickBench' },
  { id: 'library', label: 'Library', hint: 'The LDraw community parts library' },
];

/** Opens on your own parts once there are any, otherwise on the basic set. */
export function initialSource(): PartSource {
  const { recent, favourites } = partPicks.store.getState();
  const building = editorStore.getState().history.present.bricks.size > 0;
  const ownsSets = inventory.store.getState().lists.length > 0;
  return recent.length > 0 || favourites.length > 0 || building || ownsSets ? 'mine' : 'basic';
}

type Props = TileContext & {
  readonly finder: Finder;
  readonly source: PartSource;
  readonly onSource: (source: PartSource) => void;
};

/** Browsing without a search: your parts, the basic set or the whole library. */
export function PartSources({ finder, source, onSource, ...tile }: Props) {
  return (
    <>
      <div className="segmented source-switch" role="group" aria-label="Part source">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={source === s.id}
            title={s.hint}
            onClick={() => {
              onSource(s.id);
              if (s.id !== 'basic') partLibrary.request();
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {source === 'mine' && (
        <div className="part-scroll">
          <MineParts finder={finder} {...tile} />
        </div>
      )}
      {source === 'basic' && <BasicParts finder={finder} {...tile} />}
      {source === 'library' && <LibraryParts finder={finder} {...tile} />}
    </>
  );
}
