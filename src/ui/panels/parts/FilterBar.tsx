import type { FootprintCount } from '../../../core/parts/finder/finder';
import { FEATURES, HEIGHTS } from '../../../core/parts/finder/tags';
import type { PartFilters } from '../../../state/finderSession';
import { partLibrary } from '../../../state/library';

type Props = {
  readonly filters: PartFilters;
  readonly footprints: readonly FootprintCount[];
  readonly onChange: (filters: PartFilters) => void;
  /** Offers the Owned filter: the user has added parts lists. */
  readonly ownable?: boolean;
  /** Offers the Printed filter: the library has parts with prints or stickers. */
  readonly printable?: boolean;
};

type ToggleProps = {
  readonly label: string;
  readonly title: string;
  readonly pressed: boolean;
  readonly onToggle: () => void;
};

function Toggle({ label, title, pressed, onToggle }: ToggleProps) {
  return (
    <button type="button" className="filter-toggle" aria-pressed={pressed} title={title} onClick={onToggle}>
      {label}
    </button>
  );
}

/** Size, height and shape: three quick ways to narrow thousands of parts to a handful; then the parts the user owns, and prints. */
export function FilterBar({ filters, footprints, onChange, ownable = false, printable = false }: Props) {
  // the library's sizes join the list once it loads, so start as soon as the filters are in reach
  const prepare = (): void => partLibrary.request();
  // a value can also change without focus or a pointer, e.g. from assistive technology
  const change = (next: PartFilters): void => {
    prepare();
    onChange(next);
  };
  return (
    <div className="filter-bar" role="group" aria-label="Filter parts" onFocus={prepare} onPointerEnter={prepare}>
      <select
        aria-label="Part size"
        className="select select-sm"
        value={filters.footprint ?? ''}
        onChange={(e) => change({ ...filters, footprint: footprints.find((f) => f.key === e.target.value)?.key })}
      >
        <option value="">Size</option>
        {footprints.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Part height"
        className="select select-sm"
        value={filters.height ?? ''}
        onChange={(e) => change({ ...filters, height: HEIGHTS.find((h) => h.id === e.target.value)?.id })}
      >
        <option value="">Height</option>
        {HEIGHTS.map((h) => (
          <option key={h.id} value={h.id}>
            {h.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Part shape"
        className="select select-sm"
        value={filters.feature ?? ''}
        onChange={(e) => change({ ...filters, feature: FEATURES.find((f) => f.id === e.target.value)?.id })}
      >
        <option value="">Shape</option>
        {FEATURES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {(ownable || printable) && (
        <div className="filter-toggles">
          {ownable && (
            <Toggle label="Owned" title="Only parts you own" pressed={Boolean(filters.owned)} onToggle={() => change({ ...filters, owned: filters.owned ? undefined : true })} />
          )}
          {printable && (
            <Toggle
              label="Printed"
              title="Only parts with a print or stickers"
              pressed={Boolean(filters.printed)}
              onToggle={() => change({ ...filters, printed: filters.printed ? undefined : true })}
            />
          )}
        </div>
      )}
    </div>
  );
}
