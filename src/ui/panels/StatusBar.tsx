import type { ReactNode } from 'react';
import { getColor } from '../../core/colors';
import { useEditor } from '../../state/editorStore';
import type { Tool } from '../../state/types';

const HINTS: Readonly<Record<Tool, ReactNode>> = {
  build: (
    <>
      Click to place · <kbd>R</kbd> rotate · <kbd>Alt</kbd>-click picks up a brick · <kbd>Esc</kbd> stop building
    </>
  ),
  select: (
    <>
      Click or drag a box to select · drag bricks to move · arrows nudge · <kbd>Del</kbd> deletes
    </>
  ),
  paint: <>Click bricks to paint them</>,
  erase: <>Click bricks to remove them</>,
};

function Hint() {
  const tool = useEditor((s) => s.tool);
  const isPasting = useEditor((s) => s.pastePayload !== null);
  const isBlocked = useEditor((s) => s.placementValid === false);
  const colorName = useEditor((s) => getColor(s.activeColorId)?.name ?? '');

  if (isBlocked) return <span className="status-hint is-blocked">No room here: the part would overlap another brick.</span>;
  if (isPasting) {
    return (
      <span className="status-hint">
        Click to place the copy · <kbd>R</kbd> rotate · <kbd>Esc</kbd> cancel
      </span>
    );
  }
  if (tool === 'paint') return <span className="status-hint">Click bricks to paint them {colorName}</span>;
  return <span className="status-hint">{HINTS[tool]}</span>;
}

export function StatusBar() {
  const cursor = useEditor((s) => s.cursor);
  const count = useEditor((s) => s.history.present.bricks.size);
  const selected = useEditor((s) => s.selection.size);

  return (
    <footer className="statusbar">
      <Hint />
      <span className="status-coords" aria-label="Cursor position">
        {cursor ? (
          <>
            <span>X</span>
            {cursor.x} <span>Y</span>
            {cursor.y} <span>Z</span>
            {cursor.z}
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="status-counts" data-testid="status-counts">
        {count} brick{count === 1 ? '' : 's'}
        {selected > 0 ? ` · ${selected} selected` : ''}
      </span>
    </footer>
  );
}
