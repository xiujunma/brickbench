import { useStore } from 'zustand';
import type { LeftOutReason, PartTally } from '../../core/io/ldrawImport/importLDraw';
import { useEditor } from '../../state/editorStore';
import { importReportStore } from '../../state/importReport';
import { Dialog } from '../components/Dialog';

/** Rows a group lists before it sums up the rest. */
const MAX_ROWS = 100;

const LEFT_OUT: Readonly<Record<LeftOutReason, { readonly title: string; readonly why: string }>> = {
  missing: { title: 'Not in BrickBench', why: 'BrickBench doesn’t have these parts yet.' },
  'missing-file': {
    title: 'In files not opened',
    why: 'The model takes these from other files. Open the .mpd or Studio file that holds the whole model.',
  },
  shapes: { title: 'Drawing shapes', why: 'Shapes the model draws itself, such as strings and wires. They aren’t LEGO parts.' },
  turned: {
    title: 'On their side or at an angle',
    why: 'BrickBench builds parts upright and turns them in quarter turns, so parts on their side, upside down or at an angle stay out.',
  },
  'off-grid': { title: 'Between studs', why: 'These sit between studs or plates, as on jumper plates, hinges and Technic pins.' },
  overlapping: { title: 'Overlapping', why: 'On the grid these would overlap parts already in, which BrickBench doesn’t allow.' },
  outside: { title: 'Outside the building area', why: 'These lie beyond the building area.' },
};

interface Row {
  readonly label: string;
  readonly count: number;
}

const sum = (rows: readonly Row[]): number => rows.reduce((total, row) => total + row.count, 0);

function Group({ title, why, rows }: { readonly title: string; readonly why: string; readonly rows: readonly Row[] }) {
  const shown = rows.slice(0, MAX_ROWS);
  const rest = rows.slice(MAX_ROWS);
  return (
    <details className="import-group">
      <summary>
        <span>{title}</span>
        <span className="count">{sum(rows).toLocaleString('en')}</span>
      </summary>
      <p>{why}</p>
      <table className="parts-table">
        <tbody>
          {shown.map((row) => (
            <tr key={row.label}>
              <td className="num">{row.count.toLocaleString('en')}</td>
              <td>{row.label}</td>
            </tr>
          ))}
          {rest.length > 0 && (
            <tr>
              <td className="num">{sum(rest).toLocaleString('en')}</td>
              <td>and {rest.length.toLocaleString('en')} more kinds</td>
            </tr>
          )}
        </tbody>
      </table>
    </details>
  );
}

function changes(plain: readonly PartTally[], moved: readonly PartTally[], squared: readonly PartTally[], recoloured: readonly Row[]) {
  return [
    { key: 'squared', title: 'Turned square', why: 'Submodels stood at an angle for show, turned to the nearest quarter turn.', rows: squared },
    { key: 'moved', title: 'Lined up', why: 'Submodels built a little off the rest, moved up to half a stud or plate to line up.', rows: moved },
    { key: 'plain', title: 'Came in plainer', why: 'Printed and stickered parts the library lacks, built without their print or stickers, or with less of them.', rows: plain },
    { key: 'recoloured', title: 'Nearest colours', why: 'Colours BrickBench doesn’t have, built in the nearest it does.', rows: recoloured },
  ].filter((change) => change.rows.length > 0);
}

/** What came in from the LDraw or Studio file just opened, and why the rest did not. */
export function ImportReportDialog() {
  const isOpen = useEditor((s) => s.dialog === 'import-report');
  const close = useEditor((s) => s.closeDialog);
  const shown = useStore(importReportStore, (s) => s.shown);
  if (!shown) return null;
  const { report, note } = shown;
  const recoloured = report.recoloured.map((r) => ({ label: `${r.from} → ${r.to}`, count: r.count }));
  const changed = changes(report.plain, report.moved, report.squared, recoloured);
  const n = (value: number): string => value.toLocaleString('en');
  const summary = report.placed === report.parts ? `All ${n(report.parts)} parts came in.` : `${n(report.placed)} of ${n(report.parts)} parts came in.`;
  const unreadable = report.unreadable === 1 ? '1 line of the file could not be read.' : `${n(report.unreadable)} lines of the file could not be read.`;
  const looping =
    report.looping === 1 ? '1 submodel was left out for containing itself.' : `${n(report.looping)} submodels were left out for containing themselves.`;

  const footer = (
    <>
      <span>{shown.name}</span>
      <button type="button" className="btn btn-primary" onClick={() => close('import-report')}>
        Done
      </button>
    </>
  );

  return (
    <Dialog id="import-report" title="What came in" open={isOpen} onClose={() => close('import-report')} footer={footer}>
      <p className="lede" data-testid="import-summary">
        {summary}
      </p>
      {note && <p className="import-note">{note}</p>}
      {report.leftOut.length > 0 && (
        <>
          <h3 className="import-heading">Left out</h3>
          <div className="import-groups">
            {report.leftOut.map((group) => (
              <Group key={group.reason} title={LEFT_OUT[group.reason].title} why={LEFT_OUT[group.reason].why} rows={group.parts} />
            ))}
          </div>
        </>
      )}
      {changed.length > 0 && (
        <>
          <h3 className="import-heading">Changed to fit</h3>
          <div className="import-groups">
            {changed.map((change) => (
              <Group key={change.key} title={change.title} why={change.why} rows={change.rows} />
            ))}
          </div>
        </>
      )}
      {report.unreadable > 0 && <p className="import-fine">{unreadable}</p>}
      {report.looping > 0 && <p className="import-fine">{looping}</p>}
    </Dialog>
  );
}
