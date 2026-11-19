import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/desktop/protocol';

export interface MenuActions {
  readonly platform: NodeJS.Platform;
  /** Adds Reload and the developer tools. */
  readonly dev: boolean;
  /** Has the page carry out a command. */
  command(command: MenuCommand): void;
  /** Asks for a file and opens it. */
  open(): void;
  openExternal(url: string): void;
}

/**
 * The app menu. Commands go to the page, which carries them out as its own
 * File menu and keys do. Keys reach the page first: a key the page acts on
 * (⌘Z in the scene) never reaches the menu, and one it leaves (⌘Z in a text
 * box) comes to the menu, whose Undo then undoes the typing. Cut, copy and
 * paste keep their native roles, which text boxes need on macOS.
 */
export function menuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  const mac = actions.platform === 'darwin';
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    id: command,
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => actions.command(command),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };

  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      item('New Model', 'new', 'CmdOrCtrl+N'),
      { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => actions.open() },
      item('Open Sample Cottage', 'open-sample'),
      separator,
      item('Save to File', 'save', 'CmdOrCtrl+S'),
      { label: 'Export', submenu: [item('LDraw Model (.ldr)', 'export-ldraw'), item('3D Model (.glb)', 'export-glb'), item('Image (.png)', 'export-png')] },
      separator,
      item('Building Instructions…', 'instructions'),
      item('Time-lapse Video…', 'timelapse'),
      item('Parts List…', 'parts-list'),
      item('Your Parts…', 'my-parts'),
      separator,
      mac ? { role: 'close' } : { role: 'quit' },
    ],
  };
  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [item('Undo', 'undo', 'CmdOrCtrl+Z'), item('Redo', 'redo', 'Shift+CmdOrCtrl+Z'), separator, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
  };
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      // the page's own F and Home keys do these; letters as menu keys would steal them from text boxes
      item('Frame Model', 'frame'),
      item('Reset View', 'reset-view'),
      separator,
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      separator,
      { role: 'togglefullscreen' },
      ...(actions.dev ? [separator, { role: 'reload' } as const, { role: 'toggleDevTools' } as const] : []),
    ],
  };
  const help: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      item('Mouse & Keyboard', 'help'),
      item('Privacy and Credits', 'about'),
      { label: 'LDraw Parts Library', click: () => actions.openExternal('https://library.ldraw.org') },
    ],
  };
  return [...(mac ? [{ role: 'appMenu' } as const] : []), file, edit, view, { role: 'windowMenu' }, help];
}
