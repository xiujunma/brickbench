import { connectDesktop, desktopApi, savedNotice, type MenuCommand, type SavedPayload } from '../desktop/protocol';
import { getEngine } from '../editor/engineRegistry';
import { isTypingTarget } from '../editor/keyboard';
import { exportGlbFile, exportImage, exportLDrawFile, newModel, openGivenFile, openSample, saveModelFile } from '../state/commands';
import { editorStore } from '../state/editorStore';
import type { DialogId } from '../state/types';

/** The menu's Undo and Redo: of the typing in a text box, or of the model, as ⌘Z does. */
function undoOrRedo(command: 'undo' | 'redo'): void {
  if (isTypingTarget(document.activeElement)) {
    // the menu only sees ⌘Z when the page left it, as it does in text boxes
    document.execCommand(command);
    return;
  }
  const state = editorStore.getState();
  if (state.dialog === null) state[command]();
}

const openDialog = (dialog: DialogId) => (): void => editorStore.getState().openDialog(dialog);

/** What each menu command does: what the same choice in the page's own File menu, or the same keys, do. */
const ACTIONS: Readonly<Record<MenuCommand, () => unknown>> = {
  new: newModel,
  'open-sample': openSample,
  save: saveModelFile,
  'export-ldraw': exportLDrawFile,
  'export-glb': exportGlbFile,
  'export-png': exportImage,
  instructions: openDialog('instructions'),
  timelapse: openDialog('timelapse'),
  'parts-list': openDialog('parts-list'),
  'my-parts': openDialog('my-parts'),
  help: openDialog('help'),
  about: openDialog('about'),
  undo: () => undoOrRedo('undo'),
  redo: () => undoOrRedo('redo'),
  frame: () => getEngine()?.frameAll(),
  'reset-view': () => getEngine()?.resetView(),
};

/** Commands that stay safe while a dialog is open: the rest would close it, and stop whatever it is doing. */
const WHILE_A_DIALOG_IS_OPEN: ReadonlySet<MenuCommand> = new Set(['save', 'undo', 'redo']);

function run(command: MenuCommand): void {
  if (editorStore.getState().dialog !== null && !WHILE_A_DIALOG_IS_OPEN.has(command)) return;
  void ACTIONS[command]();
}

/** Says where a saved file went, as the desktop app's Save dialog decided; nothing when it was cancelled. */
function announceSaved(saved: SavedPayload): void {
  const notice = savedNotice(saved);
  if (notice) editorStore.getState().toast(notice.message, notice.tone);
}

/** In the desktop app, takes commands from its menu, the files it is asked to open and where saves went; in a browser, does nothing. */
export function startDesktop(): void {
  const api = desktopApi();
  if (!api) return;
  connectDesktop(api, { run, openFile: (file) => void openGivenFile(file), saved: announceSaved });
}
