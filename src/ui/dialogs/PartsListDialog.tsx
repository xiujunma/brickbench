import { useMemo } from 'react';
import type { Catalogue } from '../../core/inventory/read';
import { allotStock } from '../../core/inventory/stock';
import { buildPartsList } from '../../core/io/partsList';
import { getPart } from '../../core/parts/catalog';
import { exportCatalogueList } from '../../state/catalogueLists';
import { exportPartsCsv } from '../../state/commands';
import { useEditor } from '../../state/editorStore';
import { bricksOf } from '../../state/selectors';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Menu, MenuItem } from '../components/Menu';
import { cssVars } from '../platform';
import { useStock } from '../useStock';

export function PartsListDialog() {
  const isOpen = useEditor((s) => s.dialog === 'parts-list');
  const close = useEditor((s) => s.closeDialog);
  const model = useEditor((s) => s.history.present);
  const stock = useStock();
  const rows = useMemo(() => {
    const list = isOpen ? buildPartsList(bricksOf(model), getPart) : [];
    // with the user's sets added, each row says how many of it they have and still need
    return stock.active ? allotStock(list, stock.owned, getPart) : list.map((row) => ({ ...row, have: 0, missing: 0 }));
  }, [isOpen, model, stock]);
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing, 0);
  // with the user's sets, what they lack; without, the whole model
  const toBuy = rows.length > 0 && (!stock.active || missing > 0);
  const buy = (catalogue: Catalogue, close: () => void): void => {
    close();
    void exportCatalogueList(catalogue);
  };

  const footer = (
    <>
      <span>
        {total} bricks · {rows.length} different
        {stock.active && (missing > 0 ? ` · ${missing} missing from your parts` : ' · all in your parts')}
      </span>
      <span className="dialog-actions">
        {toBuy && (
          <Menu label={stock.active ? 'Buy missing parts' : 'Buy these parts'}>
            {(close) => (
              <>
                <MenuItem icon="save" label="BrickLink wanted list (.xml)" onSelect={() => buy('bricklink', close)} />
                <MenuItem icon="save" label="Rebrickable parts list (.csv)" onSelect={() => buy('rebrickable', close)} />
              </>
            )}
          </Menu>
        )}
        <button type="button" className="btn btn-primary" onClick={exportPartsCsv} disabled={rows.length === 0}>
          <Icon name="save" size={16} /> Download CSV
        </button>
      </span>
    </>
  );

  return (
    <Dialog id="parts-list" title="Parts list" open={isOpen} onClose={() => close('parts-list')} footer={footer}>
      {rows.length === 0 ? (
        <p className="lede">The model is empty. Place some bricks first.</p>
      ) : (
        <table className="parts-table">
          <thead>
            <tr>
              <th className="num">Qty</th>
              <th>Part</th>
              <th>LDraw</th>
              <th>Colour</th>
              {stock.active && (
                <>
                  <th className="num">Have</th>
                  <th className="num">Missing</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.partId}|${row.colorId}`}>
                <td className="num">{row.quantity}</td>
                <td>{row.partName}</td>
                <td className="code">{row.ldraw ?? '—'}</td>
                <td>
                  <span className="colour">
                    <span className="dot" style={cssVars({ '--c': row.colorHex })} />
                    {row.colorName}
                  </span>
                </td>
                {stock.active && (
                  <>
                    <td className="num">{row.have}</td>
                    <td className={row.missing > 0 ? 'num short' : 'num'}>{row.missing > 0 ? row.missing : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
