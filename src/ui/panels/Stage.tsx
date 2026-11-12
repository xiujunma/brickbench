import { useEffect, useRef, useState } from 'react';
import { getPart } from '../../core/parts/catalog';
import { EditorController } from '../../editor/EditorController';
import { getEngine, setEngine } from '../../editor/engineRegistry';
import { editorStore, useEditor } from '../../state/editorStore';
import { partLibrary } from '../../state/library';
import type { Tool } from '../../state/types';
import { Icon, type IconName } from '../components/Icon';
import { BUILD_AREA_ID } from '../focusTargets';

interface ToolInfo {
  readonly id: Tool;
  readonly label: string;
  readonly key: string;
  readonly icon: IconName;
}

const TOOLS: readonly ToolInfo[] = [
  { id: 'select', label: 'Select & move', key: 'V', icon: 'cursor' },
  { id: 'build', label: 'Build', key: 'B', icon: 'brick' },
  { id: 'paint', label: 'Paint', key: 'P', icon: 'drop' },
  { id: 'erase', label: 'Erase', key: 'E', icon: 'eraser' },
];

function rotate(): void {
  const engine = getEngine();
  if (engine?.rotateGesture(1)) return;
  const state = editorStore.getState();
  if (state.tool === 'build') state.rotateBuild(1);
  else if (state.selection.size > 0 && !state.rotateSelection(1)) {
    state.toast('There is no room to turn the selection there.', 'error');
  }
}

function ToolDock() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <div className="tool-dock" role="toolbar" aria-label="Tools">
      {TOOLS.map((info) => (
        <button
          key={info.id}
          type="button"
          className="dock-btn"
          aria-label={info.label}
          aria-pressed={tool === info.id}
          data-tip={`${info.label} (${info.key})`}
          onClick={() => setTool(info.id)}
        >
          <Icon name={info.icon} />
          <span className="dock-key" aria-hidden="true">
            {info.key}
          </span>
        </button>
      ))}
      <span className="dock-sep" aria-hidden="true" />
      <button type="button" className="dock-btn" aria-label="Rotate" data-tip="Rotate (R)" onClick={rotate}>
        <Icon name="rotate" />
      </button>
      <button type="button" className="dock-btn" aria-label="Frame" data-tip="Frame selection (F)" onClick={() => getEngine()?.frameSelection()}>
        <Icon name="frame" />
      </button>
      <button type="button" className="dock-btn" aria-label="Reset view" data-tip="Reset view (Home)" onClick={() => getEngine()?.resetView()}>
        <Icon name="home" />
      </button>
    </div>
  );
}

function EmptyHint() {
  const isEmpty = useEditor((s) => s.history.present.bricks.size === 0);
  const partName = useEditor((s) => getPart(s.activePartId)?.name ?? 'a part');
  const tool = useEditor((s) => s.tool);
  if (!isEmpty) return null;
  const message = tool === 'build' ? `Click the baseplate to place a ${partName}.` : 'Press B or pick a part to start building.';
  return (
    <div className="empty-hint" role="note">
      <span className="step">
        <Icon name="brick" />
      </span>
      <div>
        <strong>{message}</strong>
        <p>Pick parts on the left and colours on the right. Right-drag to look around.</p>
      </div>
    </div>
  );
}

function PasteBanner() {
  const isPasting = useEditor((s) => s.pastePayload !== null);
  if (!isPasting) return null;
  return (
    <div className="paste-banner" role="status">
      Click to place the copy · <kbd>R</kbd> rotate · <kbd>Esc</kbd> cancel
    </div>
  );
}

function ViewportHost() {
  const ref = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const tool = useEditor((s) => s.tool);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let controller: EditorController;
    try {
      controller = new EditorController(container, editorStore, getPart, partLibrary.meshes);
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : 'Unknown error');
      return;
    }
    setEngine(controller);
    return () => {
      setEngine(null);
      controller.dispose();
    };
  }, []);

  return (
    <div ref={ref} className="viewport" data-tool={tool} data-testid="viewport">
      {failure && (
        <div className="viewport-error" role="alert">
          <strong>The 3D view could not start.</strong>
          <span>Your browser may have WebGL turned off. ({failure})</span>
        </div>
      )}
    </div>
  );
}

export function Stage() {
  return (
    <main id={BUILD_AREA_ID} className="stage" aria-label="Build area" tabIndex={-1}>
      <ViewportHost />
      <EmptyHint />
      <PasteBanner />
      <ToolDock />
    </main>
  );
}
