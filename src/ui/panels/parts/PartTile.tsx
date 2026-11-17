import type { DragEvent } from 'react';
import type { PartDef } from '../../../core/parts/types';
import { PART_DRAG_TYPE } from '../../../editor/dragAndDrop';
import { Icon } from '../../components/Icon';
import { useThumbnail } from '../../thumbnails';

const EMPTY_DRAG_IMAGE = typeof Image !== 'undefined' ? new Image() : null;
if (EMPTY_DRAG_IMAGE) EMPTY_DRAG_IMAGE.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Keeps sizes like "2 × 4 × 2/3" on one line so names break between words, not numbers. */
function PartName({ name }: { readonly name: string }) {
  const match = /^(.*?)(\d+ × \d+(?: × [\d/.]+)?)(.*)$/.exec(name);
  if (!match) return <>{name}</>;
  const [, before, size, after] = match;
  return (
    <>
      {before}
      <span className="nowrap">{size}</span>
      {after}
    </>
  );
}

type Props = {
  readonly part: PartDef;
  readonly colorId: number;
  readonly isActive: boolean;
  readonly onPick: (partId: string) => void;
  readonly isStarred: boolean;
  readonly onStar: (partId: string) => void;
  /** Picked by Enter in the search box. */
  readonly isHighlighted?: boolean;
  /** Extra tooltip text, such as who drew a library part. */
  readonly credit?: string | undefined;
  /** A short note under the name, such as how many the model uses. */
  readonly badge?: string | undefined;
  /** Shows the note as a warning, such as when the model uses more than the user owns. */
  readonly badgeAlert?: boolean;
  readonly id?: string | undefined;
};

export function PartTile({ part, colorId, isActive, onPick, isStarred, onStar, isHighlighted = false, credit, badge, badgeAlert = false, id }: Props) {
  const url = useThumbnail(part.id, colorId);
  const code = part.ldraw?.file.replace(/\.dat$/, '');
  const title = [part.name, code ? `LDraw ${code}` : null, credit].filter(Boolean).join(' · ');

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    onPick(part.id);
    event.dataTransfer.setData(PART_DRAG_TYPE, part.id);
    event.dataTransfer.effectAllowed = 'copy';
    if (EMPTY_DRAG_IMAGE) event.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);
  };

  return (
    <div className={isHighlighted ? 'part-tile-wrap is-highlighted' : 'part-tile-wrap'} role="listitem" id={id}>
      <button
        type="button"
        className="part-tile"
        aria-pressed={isActive}
        title={title}
        draggable
        onDragStart={handleDragStart}
        onClick={() => onPick(part.id)}
      >
        <span className="part-thumb">
          {url ? <img src={url} alt="" width={96} height={96} draggable={false} /> : <span className="thumb-skeleton" />}
        </span>
        <span className="part-name">
          <PartName name={part.name} />
          {(code || badge) && (
            <span className="part-code">
              {code}
              {badge && <span className={badgeAlert ? 'part-badge is-over' : 'part-badge'}>{badge}</span>}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="part-star"
        aria-pressed={isStarred}
        aria-label={`Favourite ${part.name}`}
        title={isStarred ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() => onStar(part.id)}
      >
        <Icon name="star" size={14} />
      </button>
    </div>
  );
}
