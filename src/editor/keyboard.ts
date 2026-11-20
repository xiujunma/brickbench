import type { Vec3 } from '../core/grid';
import type { EditorController } from './EditorController';

/** True when the key press belongs to a text field rather than the editor. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Snaps the camera's view direction to the nearest grid axis on the ground. */
function nudge(controller: EditorController, key: string, vertical: boolean): Vec3 | null {
  if (vertical && (key === 'arrowup' || key === 'arrowdown')) {
    return { x: 0, y: key === 'arrowup' ? 1 : -1, z: 0 };
  }
  const forward = controller.groundForward();
  const alongX = Math.abs(forward.x) > Math.abs(forward.z);
  const ahead = alongX ? { x: Math.sign(forward.x), z: 0 } : { x: 0, z: Math.sign(forward.z) };
  // right of the view direction: forward × up
  const right = { x: -ahead.z, z: ahead.x };
  switch (key) {
    case 'arrowup':
      return { x: ahead.x, y: 0, z: ahead.z };
    case 'arrowdown':
      return { x: -ahead.x, y: 0, z: -ahead.z };
    case 'arrowright':
      return { x: right.x, y: 0, z: right.z };
    case 'arrowleft':
      return { x: -right.x, y: 0, z: -right.z };
    default:
      return null;
  }
}

function withModifier(controller: EditorController, key: string, shift: boolean): boolean {
  const state = controller.store.getState();
  switch (key) {
    case 'z':
      if (shift) state.redo();
      else state.undo();
      return true;
    case 'y':
      state.redo();
      return true;
    case 'c':
      if (state.copySelection()) state.toast(`Copied ${state.selection.size} brick${state.selection.size === 1 ? '' : 's'}.`);
      return true;
    case 'x':
      state.cutSelection();
      return true;
    case 'v':
      if (!state.paste()) state.toast('Nothing to paste yet. Copy some bricks first.');
      return true;
    case 'd':
      state.duplicateSelection();
      return true;
    case 'a':
      state.selectAll();
      return true;
    default:
      return false;
  }
}

function plain(controller: EditorController, event: KeyboardEvent, key: string): boolean {
  const state = controller.store.getState();
  switch (key) {
    case 'v':
      state.setTool('select');
      return true;
    case 'b':
      state.setTool('build');
      return true;
    case 'p':
      state.setTool('paint');
      return true;
    case 'e':
      state.setTool('erase');
      return true;
    case 'r': {
      const dir = event.shiftKey ? -1 : 1;
      if (controller.rotateGesture(dir)) return true;
      if (state.tool === 'build') state.rotateBuild(dir);
      else if (state.selection.size > 0 && !state.rotateSelection(dir)) {
        state.toast('There is no room to turn the selection there.', 'error');
      }
      return true;
    }
    case 'delete':
    case 'backspace':
      state.deleteSelection();
      return true;
    case 'escape':
      // only claim the key when it actually stopped something
      if (controller.cancelGesture()) return true;
      if (state.pastePayload) state.setTool('select');
      else if (state.selection.size > 0) state.clearSelection();
      // nothing else to stop: done arranging steps
      else if (state.stepEditor) state.closeSteps();
      else if (state.tool !== 'select') state.setTool('select');
      else return false;
      return true;
    case 'f':
      controller.frameSelection();
      return true;
    // the step editor's previous and next step
    case '[':
    case ']': {
      if (!state.stepEditor) return false;
      const { at } = state.stepEditor;
      state.goToStep({ ...at, index: at.index + (key === ']' ? 1 : -1) });
      return true;
    }
    case 'home':
      controller.resetView();
      return true;
    default: {
      if (state.selection.size === 0) return false;
      const delta = nudge(controller, key, event.shiftKey);
      if (!delta) return false;
      if (!state.moveSelection(delta)) state.toast('Something is in the way.', 'error');
      return true;
    }
  }
}

/** True while a menu (popover) is open: menus own the keyboard then, including Escape. */
function menuIsOpen(): boolean {
  try {
    return document.querySelector(':popover-open') !== null;
  } catch {
    // browsers without the popover API have no open popovers either
    return false;
  }
}

/** Editor shortcuts that act on the scene; app-level shortcuts live in the UI. */
export function attachKeyboard(controller: EditorController): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    if (controller.store.getState().dialog !== null || menuIsOpen()) return;
    const key = event.key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    const handled = modifier ? withModifier(controller, key, event.shiftKey) : !event.altKey && plain(controller, event, key);
    if (handled) event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
