import { useRef, useState } from 'react';
import { getColor } from '../../core/colors';
import { BASEPLATE_SIZES } from '../../core/io/modelFile';
import {
  exportGlbFile,
  exportImage,
  exportLDrawFile,
  newModel,
  openModelFile,
  openSample,
  recoverEarlierSession,
  saveModelFile,
} from '../../state/commands';
import { useEditor } from '../../state/editorStore';
import { useBackupAvailable } from '../../state/sessionBackup';
import { BrandMark, Icon } from '../components/Icon';
import { Menu, MenuItem } from '../components/Menu';
import { cssVars, shortcut } from '../platform';
import { AGENT_TOGGLE_ID } from '../focusTargets';
import { useAgentLink } from './agent/useAgent';

export type Drawer = 'parts' | 'colors' | null;

const BASEPLATE_COLORS = [2, 10, 378, 19, 71, 72, 15, 1, 0];

function FileMenu() {
  const openDialog = useEditor((s) => s.openDialog);
  const canRecover = useBackupAvailable();
  return (
    <Menu label="File">
      {(close) => {
        const run = (action: () => unknown) => () => {
          close();
          void action();
        };
        return (
          <>
            <MenuItem icon="plus" label="New model" onSelect={run(newModel)} />
            <MenuItem icon="folder" label="Open…" shortcut={shortcut('O')} onSelect={run(openModelFile)} />
            <MenuItem icon="save" label="Save to file" shortcut={shortcut('S')} onSelect={run(saveModelFile)} />
            <MenuItem icon="brick" label="Open sample cottage" onSelect={run(openSample)} />
            {canRecover && <MenuItem icon="rotate" label="Recover earlier session" onSelect={run(recoverEarlierSession)} />}
            <div className="menu-sep" role="separator" />
            <div className="menu-label">Export</div>
            <MenuItem icon="layers" label="LDraw model (.ldr)" onSelect={run(exportLDrawFile)} />
            <MenuItem icon="cube" label="3D model (.glb)" onSelect={run(exportGlbFile)} />
            <MenuItem icon="image" label="Image (.png)" onSelect={run(exportImage)} />
            <MenuItem icon="book" label="Building instructions (.pdf)…" onSelect={run(() => openDialog('instructions'))} />
            <MenuItem icon="list" label="Parts list…" onSelect={run(() => openDialog('parts-list'))} />
          </>
        );
      }}
    </Menu>
  );
}

function SceneMenu() {
  const settings = useEditor((s) => s.settings);
  const setBaseplate = useEditor((s) => s.setBaseplate);
  return (
    <Menu label="Scene">
      {() => (
        <>
          <div className="menu-label">Baseplate size</div>
          <div className="segmented" role="group" aria-label="Baseplate size">
            {BASEPLATE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={settings.baseplateSize === size}
                onClick={() => setBaseplate(size, settings.baseplateColor)}
              >
                {size === 0 ? 'None' : size}
              </button>
            ))}
          </div>
          <div className="menu-label">Baseplate colour</div>
          <div className="swatches menu-swatches" role="group" aria-label="Baseplate colour">
            {BASEPLATE_COLORS.map((id) => {
              const color = getColor(id);
              if (!color) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className="swatch"
                  style={cssVars({ '--c': color.hex })}
                  aria-label={color.name}
                  aria-pressed={settings.baseplateColor === id}
                  title={color.name}
                  onClick={() => setBaseplate(settings.baseplateSize, id)}
                />
              );
            })}
          </div>
        </>
      )}
    </Menu>
  );
}

function ModelName() {
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  return (
    <div className="model-name">
      <input
        aria-label="Model name"
        value={draft ?? name}
        maxLength={120}
        spellCheck={false}
        onFocus={(event) => {
          setDraft(name);
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!cancelled.current && draft !== null) setName(draft);
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function SaveStatus() {
  const savedAt = useEditor((s) => s.lastSavedAt);
  if (!savedAt) return null;
  const time = new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span className="save-status" title="Your model autosaves in this browser">
      Saved {time}
    </span>
  );
}

type Props = {
  readonly drawer: Drawer;
  readonly onToggleDrawer: (drawer: 'parts' | 'colors') => void;
  readonly agentOpen: boolean;
  readonly onToggleAgent: () => void;
};

/** Opens the agent chat; a dot shows when the agent bridge is connected. */
function AgentToggle({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  const connected = useAgentLink((s) => s.status === 'connected');
  return (
    <button
      id={AGENT_TOGGLE_ID}
      type="button"
      className="btn agent-toggle"
      aria-label="Agent"
      aria-pressed={open}
      data-tip="Build with an AI agent"
      data-tip-side="below"
      onClick={onToggle}
    >
      <Icon name="sparkle" size={16} />
      <span className="agent-toggle-label">Agent</span>
      {/* the panel's status line says it in words */}
      {connected && <span className="agent-toggle-dot" aria-hidden="true" />}
    </button>
  );
}

export function TopBar({ drawer, onToggleDrawer, agentOpen, onToggleAgent }: Props) {
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const openDialog = useEditor((s) => s.openDialog);

  return (
    <header className="topbar">
      <div className="drawer-toggles">
        <button
          type="button"
          className="icon-btn"
          aria-label="Show parts"
          aria-pressed={drawer === 'parts'}
          onClick={() => onToggleDrawer('parts')}
        >
          <Icon name="panelLeft" />
        </button>
      </div>
      <div className="brand">
        <BrandMark />
        <span className="wordmark">
          Brick<em>Bench</em>
        </span>
      </div>
      <nav className="menubar" aria-label="Model menus">
        <FileMenu />
        <SceneMenu />
      </nav>
      <ModelName />
      <div className="topbar-actions">
        <SaveStatus />
        <AgentToggle open={agentOpen} onToggle={onToggleAgent} />
        <button type="button" className="icon-btn" aria-label="Undo" data-tip={`Undo (${shortcut('Z')})`} data-tip-side="below" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" data-tip={`Redo (${shortcut('Z', true)})`} data-tip-side="below" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
        <button type="button" className="icon-btn" aria-label="Help and shortcuts" data-tip="Help (?)" data-tip-side="below" onClick={() => openDialog('help')}>
          <Icon name="help" />
        </button>
        <div className="drawer-toggles">
          <button
            type="button"
            className="icon-btn"
            aria-label="Show colours"
            aria-pressed={drawer === 'colors'}
            onClick={() => onToggleDrawer('colors')}
          >
            <Icon name="panelRight" />
          </button>
        </div>
      </div>
    </header>
  );
}
