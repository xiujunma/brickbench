import type { ReactNode } from 'react';
import { useEditor } from '../../state/editorStore';
import { Dialog } from '../components/Dialog';
import { shortcut } from '../platform';

type Row = readonly [string, ReactNode];

const keys = (...list: string[]) => list.map((key) => <kbd key={key}>{key}</kbd>);

const MOUSE: readonly Row[] = [
  ['Place a part (Build)', 'Click'],
  ['Drop a part from the library', 'Drag its tile'],
  ['Orbit', 'Right-drag · Alt-drag'],
  ['Orbit in Build, Paint, Erase', 'Left-drag'],
  ['Pan', 'Middle-drag · Shift + right-drag'],
  ['Zoom', 'Scroll or pinch'],
  ['Select (Select tool)', 'Click · Shift-click adds'],
  ['Box select', 'Drag on empty space'],
  ['Move bricks', 'Drag a selected brick'],
  ['Pick up a part and colour', 'Alt-click a brick'],
];

const KEYBOARD: readonly Row[] = [
  ['Select · Build · Paint · Erase', keys('V', 'B', 'P', 'E')],
  ['Rotate (back)', keys('R', '⇧R')],
  ['Tip over, on a side or upside down (back)', keys('T', '⇧T')],
  ['Nudge selection', keys('←', '↑', '→', '↓')],
  ['Raise / lower a plate', keys('⇧↑', '⇧↓')],
  ['Delete', keys('Del')],
  ['Copy · cut · paste', keys(shortcut('C'), shortcut('X'), shortcut('V'))],
  ['Duplicate · select all', keys(shortcut('D'), shortcut('A'))],
  ['Undo · redo', keys(shortcut('Z'), shortcut('Z', true))],
  ['Frame · reset view', keys('F', 'Home')],
  ['Save · open', keys(shortcut('S'), shortcut('O'))],
  ['Search parts', keys('/')],
  ['Cancel · stop building', keys('Esc')],
  ['Previous · next instruction step', keys('[', ']')],
];

function HelpList({ rows }: { readonly rows: readonly Row[] }) {
  return (
    <dl className="help-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HelpDialog() {
  const isOpen = useEditor((s) => s.dialog === 'help');
  const close = useEditor((s) => s.closeDialog);
  const openDialog = useEditor((s) => s.openDialog);
  const about = (
    <button type="button" className="link-button" onClick={() => openDialog('about')}>
      About BrickBench, privacy and credits
    </button>
  );
  return (
    <Dialog id="help" title="Mouse & keyboard" open={isOpen} onClose={() => close('help')} footer={about}>
      <div className="help-grid">
        <section>
          <h3>Mouse</h3>
          <HelpList rows={MOUSE} />
        </section>
        <section>
          <h3>Keyboard</h3>
          <HelpList rows={KEYBOARD} />
        </section>
      </div>
    </Dialog>
  );
}
