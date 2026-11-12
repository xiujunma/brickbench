import { useMemo } from 'react';
import { buildPartsList } from '../../core/io/partsList';
import { getPart } from '../../core/parts/catalog';
import { exportPartsCsv } from '../../state/commands';
import { useEditor } from '../../state/editorStore';
import { bricksOf } from '../../state/selectors';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { cssVars } from '../platform';

export function PartsListDialog() {
  const isOpen = useEditor((s) => s.dialog === 'parts-list');
  const close = useEditor((s) => s.closeDialog);
  const model = useEditor((s) => s.history.present);
  const rows = useMemo(() => (isOpen ? buildPartsList(bricksOf(model), getPart) : []), [isOpen, model]);
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);

  const footer = (
    <>
      <span>
        {total} bricks · {rows.length} different
      </span>
      <button type="button" className="btn btn-primary" onClick={exportPartsCsv} disabled={rows.length === 0}>
        <Icon name="save" size={16} /> Download CSV
      </button>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
