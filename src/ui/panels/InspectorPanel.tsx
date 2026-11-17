import { useShallow } from 'zustand/react/shallow';
import { COLOR_GROUPS, getColor } from '../../core/colors';
import type { Brick } from '../../core/model/types';
import { getPart } from '../../core/parts/catalog';
import { getEngine } from '../../editor/engineRegistry';
import { useEditor } from '../../state/editorStore';
import { distinctPieces, selectedBricks } from '../../state/selectors';
import { Icon } from '../components/Icon';
import { cssVars, shortcut, withAlpha } from '../platform';
import { useStock } from '../useStock';
import { useThumbnail } from '../thumbnails';

function ColorSection() {
  const activeColorId = useEditor((s) => s.activeColorId);
  const hasSelection = useEditor((s) => s.selection.size > 0);
  const setActiveColor = useEditor((s) => s.setActiveColor);
  const active = getColor(activeColorId);

  return (
    <section className="inspector-section" aria-labelledby="colour-heading">
      <header className="section-head">
        <h2 id="colour-heading">Colour</h2>
        {hasSelection && <span className="hint">Paints selection</span>}
      </header>
      {active && (
        <div className="color-current">
          <span
            className={`swatch swatch-lg finish-${active.finish}`}
            style={cssVars({ '--c': active.hex, '--c-glass': withAlpha(active.hex, 0.55) })}
          />
          <div>
            <strong>{active.name}</strong>
            <code>LDraw {active.id}</code>
          </div>
        </div>
      )}
      {COLOR_GROUPS.map((group) => (
        <div key={group.id} className="swatch-group">
          <h3>{group.title}</h3>
          <div className="swatches" role="group" aria-label={`${group.title} colours`}>
            {group.colors.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`swatch finish-${color.finish}`}
                style={cssVars({ '--c': color.hex, '--c-glass': withAlpha(color.hex, 0.55) })}
                aria-label={color.name}
                aria-pressed={color.id === activeColorId}
                title={color.name}
                onClick={() => setActiveColor(color.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

interface SummaryRow {
  readonly key: string;
  readonly name: string;
  readonly hex: string;
  readonly count: number;
}

const SUMMARY_ROWS = 5;

function summarize(bricks: readonly Brick[]): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  for (const brick of bricks) {
    const key = `${brick.partId}|${brick.colorId}`;
    const row = rows.get(key);
    rows.set(key, {
      key,
      name: getPart(brick.partId)?.name ?? brick.partId,
      hex: getColor(brick.colorId)?.hex ?? '#999999',
      count: (row?.count ?? 0) + 1,
    });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count).slice(0, SUMMARY_ROWS);
}

function rotateCurrent(): void {
  const engine = getEngine();
  if (engine?.rotateGesture(1)) return;
  const state = engine?.store.getState();
  if (!state) return;
  if (state.tool === 'build') state.rotateBuild(1);
  else if (state.selection.size > 0 && !state.rotateSelection(1)) {
    state.toast('There is no room to turn the selection there.', 'error');
  }
}

/** How many of the part, in the colour, the user has left: shown once they have added their sets. */
function StockLine({ partId, colorId }: { readonly partId: string; readonly colorId: number }) {
  const stock = useStock();
  if (!stock.active) return null;
  const owned = stock.of(partId, colorId);
  const colour = getColor(colorId)?.name ?? 'this colour';
  if (!owned) return <p className="building-stock">None in your parts in {colour}.</p>;
  if (owned.left < 0) {
    return (
      <p className="building-stock is-over">
        {-owned.left} more in {colour} than your {owned.owned}.
      </p>
    );
  }
  return (
    <p className="building-stock">
      {owned.left} of your {owned.owned} left in {colour}.
    </p>
  );
}

function BuildingSection() {
  const partId = useEditor((s) => s.activePartId);
  const colorId = useEditor((s) => s.activeColorId);
  const rotation = useEditor((s) => s.buildRotation);
  const tool = useEditor((s) => s.tool);
  const pasteCount = useEditor((s) => s.pastePayload?.bricks.length ?? 0);
  const setTool = useEditor((s) => s.setTool);
  const thumbnail = useThumbnail(partId, colorId);
  const part = getPart(partId);

  if (pasteCount > 0) {
    return (
      <section className="inspector-section" aria-labelledby="building-heading">
        <header className="section-head">
          <h2 id="building-heading">Placing a copy</h2>
        </header>
        <p className="lede">
          {pasteCount} brick{pasteCount === 1 ? '' : 's'} follow your cursor. Click to place them.
        </p>
        <div className="action-row">
          <button type="button" className="btn btn-outline" onClick={rotateCurrent}>
            <Icon name="rotate" size={16} /> Rotate
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setTool('select')}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (tool !== 'build' || !part) {
    return (
      <section className="inspector-section" aria-labelledby="building-heading">
        <header className="section-head">
          <h2 id="building-heading">Selection</h2>
        </header>
        <p className="lede">Nothing selected. Click a brick to select it, or drag a box around several.</p>
      </section>
    );
  }

  return (
    <section className="inspector-section" aria-labelledby="building-heading">
      <header className="section-head">
        <h2 id="building-heading">Building with</h2>
      </header>
      <div className="building">
        {thumbnail ? <img src={thumbnail} alt="" width={52} height={52} /> : null}
        <div>
          <strong>{part.name}</strong>
          <span>
            {part.ldraw ? `LDraw ${part.ldraw.file.replace(/\.dat$/, '')} · ` : ''}turned {rotation * 90}°
          </span>
        </div>
      </div>
      <StockLine partId={partId} colorId={colorId} />
      <div className="action-row">
        <button type="button" className="btn btn-outline" onClick={rotateCurrent}>
          <Icon name="rotate" size={16} /> Rotate <kbd>R</kbd>
        </button>
      </div>
    </section>
  );
}

function SelectionSection({ bricks }: { readonly bricks: readonly Brick[] }) {
  const duplicate = useEditor((s) => s.duplicateSelection);
  const remove = useEditor((s) => s.deleteSelection);
  const rows = summarize(bricks);
  const hidden = bricks.length - rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="inspector-section" aria-labelledby="selection-heading">
      <header className="section-head">
        <h2 id="selection-heading">Selection</h2>
        <span className="count mono">{bricks.length}</span>
      </header>
      <ul className="selection-summary">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="dot" style={cssVars({ '--c': row.hex })} />
            {row.name}
            <span className="qty">×{row.count}</span>
          </li>
        ))}
        {hidden > 0 && <li className="lede">and {hidden} more</li>}
      </ul>
      <div className="action-row">
        <button type="button" className="btn btn-outline" onClick={rotateCurrent}>
          <Icon name="rotate" size={16} /> Rotate
        </button>
        <button type="button" className="btn btn-outline" onClick={duplicate} title={`Duplicate (${shortcut('D')})`}>
          <Icon name="copy" size={16} /> Duplicate
        </button>
        <button type="button" className="btn btn-outline btn-danger" onClick={remove} title="Delete (Del)">
          <Icon name="trash" size={16} /> Delete
        </button>
      </div>
    </section>
  );
}

function ModelSection() {
  const count = useEditor((s) => s.history.present.bricks.size);
  const variety = useEditor((s) => distinctPieces(s.history.present));
  const openDialog = useEditor((s) => s.openDialog);

  return (
    <section className="inspector-section" aria-labelledby="model-heading">
      <header className="section-head">
        <h2 id="model-heading">Model</h2>
      </header>
      <dl className="stats">
        <div>
          <dt>Bricks</dt>
          <dd data-testid="brick-count">{count}</dd>
        </div>
        <div>
          <dt>Unique</dt>
          <dd>{variety}</dd>
        </div>
      </dl>
      <div className="action-row">
        <button type="button" className="btn btn-outline" onClick={() => openDialog('instructions')} disabled={count === 0}>
          <Icon name="book" size={16} /> Instructions
        </button>
        <button type="button" className="btn btn-outline" onClick={() => openDialog('parts-list')} disabled={count === 0}>
          <Icon name="list" size={16} /> Parts list
        </button>
        <button type="button" className="btn btn-outline" onClick={() => getEngine()?.frameAll()}>
          <Icon name="frame" size={16} /> Frame
        </button>
      </div>
    </section>
  );
}

export function InspectorPanel() {
  const selected = useEditor(useShallow((s) => selectedBricks(s)));
  return (
    <aside className="panel panel-inspector" aria-label="Inspector">
      <ColorSection />
      {selected.length > 0 ? <SelectionSection bricks={selected} /> : <BuildingSection />}
      <ModelSection />
    </aside>
  );
}
