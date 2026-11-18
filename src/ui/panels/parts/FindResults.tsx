import type { FinderResult } from '../../../core/parts/finder/finder';
import type { PatternError } from '../../../core/parts/pattern';
import { useLibrary } from '../../../state/library';
import { LibraryCredit } from './LibraryCredit';
import { LibraryNotice } from './LibraryNotice';
import { PartGrid, type TileContext } from './PartGrid';

type Props = TileContext & {
  readonly result: FinderResult;
  readonly query: string;
  /** Why the query, which looks like a part pattern, does not read as one. */
  readonly patternError: PatternError | null;
  /** The colour the query names, which picks build in. */
  readonly colourName: string | null;
  readonly highlighted: number;
  readonly limit: number;
  readonly onMore: () => void;
  readonly onClear: () => void;
};

type SummaryProps = Pick<Props, 'result' | 'query' | 'patternError' | 'colourName' | 'highlighted' | 'onClear'>;

function Summary({ result, query, patternError, colourName, highlighted, onClear }: SummaryProps) {
  const libraryLoading = useLibrary((s) => s.status === 'loading');
  const count = result.items.length;
  const next = result.items[highlighted];
  return (
    <div className="find-note">
      <p role="status">
        {count === 0 ? 'No parts match' : `${count.toLocaleString('en')} ${count === 1 ? 'part' : 'parts'}`}
        {result.pattern && <> · by part pattern</>}
        {result.fuzzy && query.trim() && <> · nothing matched “{query.trim()}” exactly, so these are close spellings</>}
        {count === 0 && patternError && (
          <span className="find-hint">
            As a part pattern: {patternError.message} (at character {patternError.at + 1}).
          </span>
        )}
        {libraryLoading && <> · the LDraw library is still loading</>}
        {next && (
          <span className="find-hint">
            <kbd>Enter</kbd> builds with {next.name}
            {colourName && ` in ${colourName}`}
          </span>
        )}
      </p>
      <button type="button" className="link-button" aria-label="Clear search and filters" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

/** Search results from every part, built-in and library, best match first. */
export function FindResults({ result, query, patternError, colourName, highlighted, limit, onMore, onClear, ...tile }: Props) {
  const hasLibraryParts = result.items.some((item) => item.source === 'library');
  return (
    <>
      <Summary result={result} query={query} patternError={patternError} colourName={colourName} highlighted={highlighted} onClear={onClear} />
      <LibraryNotice />
      <div className="part-scroll">
        <PartGrid
          label="Matching parts"
          items={result.items}
          highlighted={highlighted}
          limit={limit}
          onMore={onMore}
          empty={<p className="empty-note">Try fewer words, another spelling, or clear the filters.</p>}
          {...tile}
        />
      </div>
      {hasLibraryParts && <LibraryCredit />}
    </>
  );
}
